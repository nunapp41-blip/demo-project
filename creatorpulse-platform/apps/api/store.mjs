import {promises as fs} from 'node:fs';
import path from 'node:path';
const initial=()=>({tracked:[],rankHistory:[],competitors:[],usage:{},createdAt:new Date().toISOString()});
export class JsonStore{
  constructor(filepath){this.filepath=path.resolve(filepath);this.state=initial();this.saveChain=Promise.resolve();}
  async init(){await fs.mkdir(path.dirname(this.filepath),{recursive:true});try{this.state=JSON.parse(await fs.readFile(this.filepath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;await this.save();}for(const k of ['tracked','rankHistory','competitors'])this.state[k]??=[];this.state.usage??={};return this;}
  async save(){const content=JSON.stringify(this.state,null,2);this.saveChain=this.saveChain.then(async()=>{const tmp=this.filepath+'.tmp';await fs.writeFile(tmp,content,{mode:0o600});await fs.rename(tmp,this.filepath);});await this.saveChain;}
  async mutate(fn){const result=fn(this.state);await this.save();return result;}
}
