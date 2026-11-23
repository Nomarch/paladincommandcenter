// AI coaching through the Anthropic API. Node-only; the local server passes the
// returned function to the Worker as env.COACH. The API key never leaves this process.
//
// Spend ceiling (by design, not configurable upward):
//   model  claude-sonnet-5-5, effort 'medium' (or 'low' via PALADIN_COACH_EFFORT)
//   refusal fallback: server-side "default", which for Sonnet 5.5 retries on Claude Sonnet 5
import Anthropic from '@anthropic-ai/sdk';

export const COACH_MODEL='claude-sonnet-5-5';
const EFFORTS=['low','medium'];

const SYSTEM=`You are the AI coach inside Paladin Command Center, a private companion app for one player leveling their first character in World of Warcraft Forever: an Alliance Human Retribution Paladin, usually playing solo.

How to coach:
- Ground every recommendation in the character sheet, objectives and journal in the <character_briefing> the app attaches to the newest message. Use only abilities, talents, gear and stats recorded there. If something you need is not recorded (a stat, a talent point count, a trained spell), say what is missing and ask, rather than assuming it.
- World of Warcraft Forever is a newer version of the game whose rules differ from Classic and retail. Your training data may predate or misdescribe it. Label each claim as one of: "Forever (per the app's sources)", "Classic reference — confirm in game", or "Suggested strategy". When you are unsure of a mechanic, rank, cost or location, say so and tell the player how to check it in game (trainer, tooltip, quest log).
- The app's own rule-based plan and the dated source list in the briefing are the best facts available; prefer them over memory and point out when you disagree with them and why.
- Be practical and concise: lead with what to do next session, then the why. Use short headings and bullet lists. No filler, no flattery.
- You cannot see the game client or change the player's data. To record progress the player uses the app's "Update progress" button.`;

function effortSetting(){
 const e=(process.env.PALADIN_COACH_EFFORT||'medium').trim().toLowerCase();
 return EFFORTS.includes(e)?e:'medium';
}

export function coachConfig(){
 return {enabled:Boolean(process.env.ANTHROPIC_API_KEY),model:COACH_MODEL,effort:effortSetting()};
}

// expose=true tells the Worker the message is safe to show the user.
class CoachError extends Error{constructor(status,message){super(message);this.status=status;this.expose=true}}

// Returns async ({briefing, history, question}) => {text, model, usage}
// history: [{role:'user'|'assistant', content:string}] oldest first, text only.
export function createCoach({apiKey=process.env.ANTHROPIC_API_KEY,baseURL=process.env.ANTHROPIC_BASE_URL}={}){
 if(!apiKey)return null;
 const client=new Anthropic({apiKey,...(baseURL?{baseURL}:{}),timeout:120_000,maxRetries:1});
 const effort=effortSetting();
 const coach=async({briefing,history,question})=>{
  const messages=[...history.map(m=>({role:m.role,content:m.content})),{role:'user',content:`<character_briefing>\n${briefing}\n</character_briefing>\n\n${question}`}];
  let response;
  try{
   response=await client.beta.messages.create({
    model:COACH_MODEL,
    max_tokens:8000,
    output_config:{effort},
    betas:['server-side-fallback-2026-07-01'],
    fallbacks:'default',
    system:SYSTEM,
    messages,
   });
  }catch(e){
   if(e instanceof Anthropic.AuthenticationError)throw new CoachError(502,'The Anthropic API rejected the API key in .env. Check ANTHROPIC_API_KEY and restart the app.');
   if(e instanceof Anthropic.PermissionDeniedError)throw new CoachError(502,'This API key is not allowed to use '+COACH_MODEL+'.');
   if(e instanceof Anthropic.RateLimitError)throw new CoachError(502,'The Anthropic API is rate limiting this key. Wait a minute and ask again.');
   if(e instanceof Anthropic.BadRequestError){console.error('Coach request rejected:',e.message);throw new CoachError(502,'The AI service rejected the request. Details are in the app\'s console window.')}
   if(e instanceof Anthropic.APIConnectionError)throw new CoachError(502,'Could not reach the Anthropic API. Check your internet connection.');
   if(e instanceof Anthropic.APIError)throw new CoachError(502,'The AI service returned an error ('+(e.status??'unknown')+'). Try again shortly.');
   throw e;
  }
  const usage={input:response.usage?.input_tokens??null,output:response.usage?.output_tokens??null};
  if(response.stop_reason==='refusal'){
   const cat=response.stop_details?.category;
   throw new CoachError(502,'The AI coach declined this question'+(cat?' ('+cat+')':'')+'. Try rephrasing it.');
  }
  const text=response.content.filter(b=>b.type==='text').map(b=>b.text).join('\n\n').trim();
  if(!text)throw new CoachError(502,'The AI coach returned no answer. Try again.');
  return {text:response.stop_reason==='max_tokens'?text+'\n\n_(Answer cut off at the length limit. Ask me to continue.)_':text,model:response.model||COACH_MODEL,usage};
 };
 coach.config={model:COACH_MODEL,effort};
 return coach;
}
