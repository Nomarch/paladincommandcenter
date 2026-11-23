                                                     
                                                                                                       
                                                                                                                                  
const reviewed='November 22, 2026';
const sources=[
 {id:'paladin',title:'Paladin class deep dive',publisher:'Blizzard',url:'https://news.blizzard.com/en-gb/article/24302099/world-of-warcraft-forever-class-deep-dives-paladin',note:'Baseline changes; beta talent details may be superseded.'},
 {id:'patch',title:'November 2 development notes',publisher:'Blizzard',url:'https://us.forums.blizzard.com/en/wow/t/wow-forever-beta-development-notes-%E2%80%93-updated-november-2/2360696/1',note:'Updated Retribution talents, including Unsealed Wrath.'},
 {id:'hotfix',title:'Hotfixes through November 20',publisher:'Blizzard',url:'https://news.blizzard.com/en-us/article/24315281/wow-forever-hotfixes-november-20-2026',note:'Two-Handed Weapon Specialization fix and dungeon entry limits.'},
 {id:'dungeons',title:'New Forever dungeons',publisher:'Blizzard',url:'https://news.blizzard.com/en-us/article/24301455/explore-the-new-dungeons-of-world-of-warcraft-forever',note:'Level bands, locations, and access requirements.'},
 {id:'legacy',title:'The Legacy system',publisher:'Blizzard',url:'https://news.blizzard.com/en-us/article/24307383/get-to-know-the-world-of-warcraft-forever-legacy-system',note:'Unlocks and perks; actual talent points may differ by character.'},
 {id:'zones',title:'What’s next for Forever',publisher:'Blizzard',url:'https://worldofwarcraft.blizzard.com/en-us/news/24303862/world-of-warcraft-forever-whats-next',note:'Riverglades progression; other route bands here are Classic references.'},
 {id:'starter',title:'New player starter guide',publisher:'Blizzard',url:'https://news.blizzard.com/en-us/article/24315280/new-players-starter-guide-welcome-to-world-of-warcraft-forever',note:'Professions and starting systems.'},
 {id:'method',title:'Paladin leveling and talents',publisher:'Method · community guide',url:'https://www.method.gg/wow-forever/wow-forever-paladin-leveling-guide-and-talents',note:'Strategy and weapon candidates. Check availability and tooltips in game.'},
];
const routes=[
 {min:1,max:10,name:'Northshire & Elwynn Forest',hub:'Goldshire',detail:'Work through nearby starter quests, then combine Goldshire objectives.',confidence:'Classic reference'              },
 {min:10,max:20,name:'Westfall & Loch Modan',hub:'Sentinel Hill',detail:'Choose nearby yellow or green nonelite quests. Change hubs when the remaining quests are too hard.',confidence:'Classic reference'              },
 {min:20,max:30,name:'Redridge, Duskwood & Wetlands',hub:'Lakeshire / Darkshire',detail:'Alternate hubs to keep quest difficulty comfortable. Skip elites until a group is convenient.',confidence:'Classic reference'              },
 {min:30,max:35,name:'Duskwood & Stranglethorn',hub:'Darkshire / Rebel Camp',detail:'Finish compact quest loops before long travel. Check the quest log for actual difficulty.',confidence:'Classic reference'              },
 {min:35,max:45,name:'Riverglades',hub:'A new chapter in Forever',detail:'Explore the new zone, intended for much of the mid-30s through mid-40s.',confidence:'Verified Forever'              },
 {min:45,max:50,name:'Tanaris, Feralas & Hinterlands',hub:'Choose the nearest quest hub',detail:'Finish accessible quests in your current zone first; avoid continent travel for a single objective.',confidence:'Classic reference'              },
 {min:50,max:55,name:'Un’Goro & Western Plaguelands',hub:'Check quest difficulty in game',detail:'Carry healing supplies and pull carefully. Use actual quest colors over these approximate bands.',confidence:'Classic reference'              },
 {min:55,max:60,name:'Winterspring & Eastern Plaguelands',hub:'Your final leveling chapter',detail:'Favor safe solo objectives and accessible gear rewards. Dungeons remain optional.',confidence:'Classic reference'              },
];
const dungeons=[
 {name:'Hall of Thanes',min:13,max:18,place:'Ironforge',note:'Easy Alliance access. Collect relevant quests before joining.'},
 {name:'Ruins of Lordaeron',min:15,max:20,place:'Tirisfal Glades',note:'Longer, riskier Alliance journey; low priority for fast solo leveling.'},
 {name:'Excavation Site',min:24,max:29,place:'Wetlands',note:'Consider a run while questing nearby.'},
 {name:'City of Dalaran',min:28,max:33,place:'Alterac Mountains',note:'Attunement starts with An Alarming Request from Emissary Jacques in Southshore.'},
 {name:'The Drowned City',min:35,max:40,place:'Stranglethorn coast',note:'Optional group detour with nearby quests.'},
 {name:'Krol’dok Stronghold',min:40,max:45,place:'Riverglades',note:'Pair with your Riverglades journey.'},
 {name:'Alcaz Prison',min:48,max:53,place:'Dustwallow Marsh',note:'Optional group content; compare travel time to questing.'},
 {name:'Blackmaw Hold',min:55,max:60,place:'Azshara',note:'A later group opportunity.'},
 {name:'Shaper’s Terrace',min:58,max:60,place:'Un’Goro Crater',note:'Near the end of the leveling journey.'},
];
const hasAbility=(p          ,name       )=>p.abilities.toLowerCase().includes(name.toLowerCase());
function currentRoute(level       ){return routes.find(r=>level>=r.min&&level<(r.max===60?61:r.max))||routes[0];}
function talentAdvice(p          ){
 const text=p.talents.toLowerCase();
 if(p.unspentTalents===null)return 'Record your available points and existing talents before spending. Legacy perks can change when points become available.';
 if(p.unspentTalents===0)return 'No unspent points recorded. Keep your allocation current after each level; prioritize efficient travel, mana sustain, and weapon damage.';
 if(!text.includes('benediction'))return 'Consider Benediction first for mana efficiency. Check its current ranks and prerequisites in your live tree before assigning a point.';
 if(!text.includes('judgement'))return 'Review Sanctified Judgement and Improved Judgement next for sustain and frequent Judgements. Verify the current prerequisites.';
 if(!text.includes('pursuit of justice'))return 'Prioritize Pursuit of Justice when your tree permits it; less travel time supports fast solo leveling.';
 if(!text.includes('seal of command'))return 'Review Seal of Command when available, then further Retribution weapon talents. Record the ability once learned so it appears in your combat guide.';
 return 'Review Conviction and Two-Handed Weapon Specialization next. Work toward Repentance and Unsealed Wrath when legal in the current tree; do not copy the old Twist of Light tree.';
}
function rotation(p          )                              {
 const steps=[{name:'Prepare & pull carefully',detail:'Use your trained Aura and Blessing, then pull a manageable target. Keep a damage Seal active if learned.'},{name:'Stay in melee range',detail:'Keep auto-attack running. Face the target and avoid chasing through extra enemies.'}];
 if(hasAbility(p,'Judgement'))steps.push({name:'Judgement',detail:'Use when ready and mana permits. In Forever, Judgement preserves your Seal.'});
 if(hasAbility(p,'Holy Strike'))steps.push({name:'Holy Strike',detail:'Use your trained rank when available, while leaving mana for healing.'});
 if(hasAbility(p,'Consecration'))steps.push({name:'Consecration · situational',detail:'Consider for a controlled multi-target pull. Skip it if the mana cost would add more downtime.'});
 steps.push({name:'Recover before the next pull',detail:hasAbility(p,'Holy Light')?'Heal early with Holy Light when needed; stop to drink before a risky pull.':'Use your known healing and recovery tools. Record trained spells to refine this guide.'});
 return steps;
}
function buildPlan(p               , objectives            =[])         {
 if(!p)return [];
 const a         =[];const add=(key       ,title       ,detail       ,category       ,confidence           ,priority       ,source        )=>a.push({key,title,detail,category,confidence,priority,source});
 const band=Math.floor((p.level-1)/5)*5+1;
 if(p.level>=6&&!hasAbility(p,'Holy Strike'))add('learn-holy-strike','Check your trainer for Holy Strike','Available from level 6 in the official class notes. Train it if missing, then add it to your trained abilities.','Training','Verified Forever',100,'paladin');
 if((p.unspentTalents??0)>0)add(`talents-${p.level}` ,`Allocate ${p.unspentTalents} unspent talent point${p.unspentTalents===1?'':'s'}`,talentAdvice(p),'Talents','Suggested strategy',95,'method');
 if(!p.gear['Main hand'])add('record-weapon','Record your current weapon','Add its name, DPS, and speed so you can compare quest rewards. Leave unknown values blank.','Gear','Suggested strategy',90);
 const quest=objectives.find(o=>o.custom&&!o.done&&o.category==='Quests');
 if(quest)add(quest.key,quest.title,'Your next unfinished quest. Combine nearby objectives and turn-ins; skip group requirements when solo.','Quests','Suggested strategy',85);
 add(`quest-loop-${p.level}`,p.level===60?'Choose your next solo objective':'Complete a nearby quest loop',`Start in ${p.zone||currentRoute(p.level).name}. Favor nonelite quests close to your level and combine their turn-ins.`,'Questing','Suggested strategy',80);
 if(p.trainedAt===null||p.trainedAt<p.level)add(`trainer-${p.level}`,'Check abilities on your next town visit',`Last trainer visit: ${p.trainedAt===null?'not recorded':`level ${p.trainedAt}`}. Check available ranks, record trained spells, repair, and sell unwanted items in one trip.`,'Training','Suggested strategy',70);
 if(p.unspentTalents===null&&p.level>=5)add('record-talents','Check your available talent points',talentAdvice(p),'Talents','Verified Forever',75,'legacy');
 if(p.level>=20&&!hasAbility(p,'Consecration'))add('learn-consecration','Check Consecration training','Baseline from level 20 in Forever. Useful situationally; prioritize sustain over unnecessary area damage.','Training','Verified Forever',60,'paladin');
 if(p.gear['Main hand'])add(`weapon-review-${band}`,'Compare your next weapon reward',`Current weapon: ${p.gear['Main hand']}${p.weaponDps!==null?` · ${p.weaponDps} DPS`:''}. Compare damage, weapon skill, and stats before spending gold.`,'Gear','Suggested strategy',65,'method');
 if(p.level>=35&&p.mount!=='warhorse'&&p.mount!=='charger'&&p.mount!=='other')add('warhorse','Plan your Warhorse milestone','Around level 40 is a community reference. Confirm the exact unlock and cost with your class trainer before buying anything.','Mounts','Confirm in game',p.level>=40?88:50,'method');
 if(p.level>=55&&p.mount!=='charger')add('charger','Investigate the Charger quest','Level 60 is the reference milestone. Ask your trainer about the current Forever quest, materials, and costs.','Mounts','Confirm in game',55,'method');
 if(!p.professions.some(x=>x.name))add('choose-professions','Choose professions that fit your route','Two gathering professions are a simple option for earning gold with fewer crafting detours. Keep personal preferences in mind.','Professions','Suggested strategy',45,'starter');
 else add(`professions-${band}`,'Gather and skill up along your route',`Keep ${p.professions.filter(x=>x.name).map(x=>x.name).join(' / ')} current when convenient. Do not interrupt a productive quest loop for small skill gains.`,'Professions','Suggested strategy',40);
 if(p.level>=25&&!p.legacy)add('legacy-review','Review your Legacy unlock','Your first level-25 character normally earns a Legacy Point. Check your panel and record chosen perks; Talented can alter talent timing.','Talents','Verified Forever',60,'legacy');
 return a.sort((x,y)=>y.priority-x.priority);
}

                                           
function parseProgress(input       , current          )                     {
  const patch                    = {};
  const level=input.match(/\b(?:level|lvl|ding(?:ed)?)\s*(?:is|to|:|=)?\s*(\d{1,2})\b/i);
  if(level && +level[1]>=1 && +level[1]<=60) patch.level=+level[1];
  const xp=input.match(/\b(?:xp|experience)\s*[:=]?\s*([\d,]+)\s*\/\s*([\d,]+)/i);
  if(xp){patch.xp=Number(xp[1].replaceAll(',',''));patch.xpMax=Number(xp[2].replaceAll(',',''));}
  const gold=input.match(/\bgold\s*[:=]?\s*(\d+(?:\.\d+)?)\b/i) || input.match(/\b(\d+(?:\.\d+)?)\s*(?:gold|g)\b/i);
  if(gold)patch.gold=+gold[1];
  const zone=input.match(/\b(?:zone\s*[:=]|now in|arrived in)\s*([^\n.;]+)/i);
  if(zone)patch.zone=zone[1].split(/,\s*(?:level|xp|gold|trained|learned|weapon)\b/i)[0].trim().slice(0,300);
  const weapon=input.match(/\bweapon\s*[:=]\s*([^\n.;]+)/i);
  if(weapon)patch.gear={...current.gear,'Main hand':weapon[1].trim().slice(0,300)};
  const learned=input.match(/\b(?:trained|learned)\s*[:=]?\s*([^\n.;]+)/i);
  if(learned)patch.abilities=[current.abilities,learned[1].trim()].filter(Boolean).join('\n').slice(0,6000);
  return patch;
}
