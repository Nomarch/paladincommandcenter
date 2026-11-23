import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
export function bindings(directory){
 fs.mkdirSync(directory,{recursive:true});const sql=new DatabaseSync(path.join(directory,'character.sqlite'));
 sql.exec('CREATE TABLE IF NOT EXISTS _local_migrations (name TEXT PRIMARY KEY)');
 if(!sql.prepare('SELECT name FROM _local_migrations WHERE name=?').get('0000_paladin')){sql.exec(fs.readFileSync('drizzle/0000_paladin.sql','utf8'));sql.prepare('INSERT INTO _local_migrations(name) VALUES(?)').run('0000_paladin')}
 class Statement{constructor(query,params=[]){this.query=query;this.params=params}bind(...params){return new Statement(this.query,params)}async first(){return sql.prepare(this.query).get(...this.params)||null}async all(){return {results:sql.prepare(this.query).all(...this.params),success:true}}async run(){const r=sql.prepare(this.query).run(...this.params);return {success:true,meta:{changes:Number(r.changes)}}}}
 const DB={prepare:query=>new Statement(query),async batch(statements){sql.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sql.exec('COMMIT');return result}catch(e){sql.exec('ROLLBACK');throw e}}};
 const bucketDir=path.join(directory,'images');fs.mkdirSync(bucketDir,{recursive:true});
 const file=key=>path.join(bucketDir,key.replaceAll('/','_'));
 const BUCKET={async put(key,bytes){fs.writeFileSync(file(key),Buffer.from(bytes))},async get(key){if(!fs.existsSync(file(key)))return null;return {body:fs.readFileSync(file(key))}},async delete(key){fs.rmSync(file(key),{force:true})}};
 return {DB,BUCKET,close:()=>sql.close()};
}
