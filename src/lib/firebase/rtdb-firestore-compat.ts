import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
export { FieldValue } from "@/lib/firebase/rtdb-transforms";
const TRANSFORM = "__edusphere_transform__";
type Operation = { kind: "set" | "update" | "create" | "delete"; path: string; data?: unknown; merge?: boolean };
type Filter = { field: string; op: string; value: unknown };
type Ordering = { field: string; direction: "asc" | "desc" };
const clone = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value));
const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const equal = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const cleanPath = (path: string) => path.split("/").filter(Boolean).join("/");
function field(data: unknown, name: string): unknown { return name === "__name__" ? undefined : name.split(".").reduce<unknown>((v, k) => isObject(v) ? v[k] : undefined, data); }
function isTransform(v: unknown, kind?: string): v is { [TRANSFORM]: string; values: unknown[] } { return isObject(v) && typeof v[TRANSFORM] === "string" && (!kind || v[TRANSFORM] === kind); }
function materialize(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (isTransform(v, "delete")) return undefined;
  if (isTransform(v, "serverTimestamp")) return new Date().toISOString();
  if (isTransform(v, "arrayUnion")) return clone(v.values);
  if (Array.isArray(v)) return v.map(materialize);
  if (isObject(v)) { const o: Record<string, unknown> = {}; for (const [k, x] of Object.entries(v)) { const y = materialize(x); if (y !== undefined) o[k] = y; } return o; }
  return v;
}
function mergeData(prev: unknown, incoming: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = isObject(prev) ? clone(prev) : {};
  if (!isObject(incoming)) return clone(incoming) as Record<string, unknown>;
  for (const [key, raw] of Object.entries(incoming)) {
    if (isTransform(raw, "delete")) delete out[key];
    else if (isTransform(raw, "arrayUnion")) { const old = Array.isArray(out[key]) ? out[key] as unknown[] : []; out[key] = [...old, ...raw.values.filter((x) => !old.some((y) => equal(x, y)))]; }
    else if (isTransform(raw, "serverTimestamp")) out[key] = new Date().toISOString();
    else if (raw instanceof Date) out[key] = raw.toISOString();
    else if (isObject(raw) && isObject(out[key])) out[key] = mergeData(out[key], raw);
    else out[key] = materialize(raw);
  }
  return out;
}
function setField(obj: Record<string, unknown>, key: string, value: unknown) { const parts = key.split("."); let cur = obj; for (const p of parts.slice(0, -1)) { if (!isObject(cur[p])) cur[p] = {}; cur = cur[p] as Record<string, unknown>; } if (value === undefined) delete cur[parts.at(-1)!]; else cur[parts.at(-1)!] = value; }
function applyUpdate(prev: unknown, data: unknown) { if (!isObject(prev) || !isObject(data)) throw new Error("NOT_FOUND"); const out = clone(prev); for (const [k, v] of Object.entries(data)) { if (isTransform(v, "delete")) setField(out, k, undefined); else if (isTransform(v, "arrayUnion")) { const old = field(out, k); const values = Array.isArray(old) ? old : []; setField(out, k, [...values, ...v.values.filter((x) => !values.some((y) => equal(x, y)))]); } else setField(out, k, materialize(v)); } return out; }
function cmp(a: unknown, b: unknown): number { if (a === b) return 0; if (a == null) return -1; if (b == null) return 1; if (typeof a === "number" && typeof b === "number") return a - b; if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b); return String(a).localeCompare(String(b)); }
function valueAt(id: string, data: Record<string, unknown>, key: string) { return key === "__name__" ? id : field(data, key); }
export class RtdbDocumentReference {
  readonly path: string; readonly id: string; readonly parent: RtdbCollectionReference;
  constructor(private readonly pool: Pool, path: string) { this.path = cleanPath(path); const parts = this.path.split("/"); this.id = parts.at(-1)!; this.parent = new RtdbCollectionReference(pool, parts.slice(0, -1).join("/")); }
  collection(name: string) { return new RtdbCollectionReference(this.pool, `${this.path}/${name}`); }
  async get() { const r = await this.pool.query("SELECT data FROM app_documents WHERE path=$1", [this.path]); return new RtdbDocumentSnapshot(this, r.rows[0]?.data ?? null); }
  async set(data: unknown, options?: { merge?: boolean }) { if (options?.merge) { const existing = await this.get(); const merged = mergeData(existing.data(), data); await this.pool.query("INSERT INTO app_documents(path,data) VALUES($1,$2) ON CONFLICT(path) DO UPDATE SET data=EXCLUDED.data,updated_at=now()", [this.path, JSON.stringify(merged)]); } else await this.pool.query("INSERT INTO app_documents(path,data) VALUES($1,$2) ON CONFLICT(path) DO UPDATE SET data=EXCLUDED.data,updated_at=now()", [this.path, JSON.stringify(materialize(data))]); }
  async create(data: unknown) { try { await this.pool.query("INSERT INTO app_documents(path,data) VALUES($1,$2)", [this.path, JSON.stringify(materialize(data))]); } catch (e) { if ((e as { code?: string }).code === "23505") throw new Error("ALREADY_EXISTS"); throw e; } }
  async update(data: unknown) { const snap = await this.get(); if (!snap.exists) throw new Error("NOT_FOUND"); await this.pool.query("UPDATE app_documents SET data=$2,updated_at=now() WHERE path=$1", [this.path, JSON.stringify(applyUpdate(snap.data(), data))]); }
  async delete() { await this.pool.query("DELETE FROM app_documents WHERE path=$1 OR left(path,length($1)+1)=$1 || '/'", [this.path]); }
  isEqual(other: RtdbDocumentReference) { return this.path === other.path; }
}
export class RtdbDocumentSnapshot {
  readonly id: string; readonly exists: boolean;
  constructor(readonly ref: RtdbDocumentReference, private readonly value: unknown) { this.id = ref.id; this.exists = value !== null && value !== undefined; }
  data() { return this.exists ? clone(this.value) as Record<string, unknown> : undefined; }
  get(name: string) { return field(this.value, name); }
}
class RtdbQuerySnapshot { readonly size: number; readonly empty: boolean; constructor(readonly docs: RtdbDocumentSnapshot[]) { this.size=docs.length; this.empty=!docs.length; } forEach(cb:(snap:RtdbDocumentSnapshot)=>void){this.docs.forEach(cb);} }
export class RtdbQuery {
  protected filters: Filter[]=[]; protected orders: Ordering[]=[]; protected maximum?: number; protected cursor?: {values:unknown[];id:string}; protected projection?: string[];
  constructor(protected readonly pool:Pool,readonly path:string,protected readonly group=false){}
  where(field:string,op:string,value:unknown){const q=this.copy();q.filters.push({field,op,value});return q;}
  orderBy(field:string,direction:"asc"|"desc"="asc"){const q=this.copy();q.orders.push({field,direction});return q;}
  limit(n:number){const q=this.copy();q.maximum=n;return q;}
  select(...fields:string[]){const q=this.copy();q.projection=fields;return q;}
  startAfter(s:RtdbDocumentSnapshot){const q=this.copy();q.cursor={id:s.id,values:q.orders.map(o=>valueAt(s.id,s.data()??{},o.field))};return q;}
  count(){return{get:async()=>{const n=(await this.get()).size;return{data:()=>({count:n})};}};}
  protected copy():this{const q=new(this.constructor as new(p:Pool,path:string,group?:boolean)=>this)(this.pool,this.path,this.group);q.filters=[...this.filters];q.orders=[...this.orders];q.maximum=this.maximum;q.cursor=this.cursor;q.projection=this.projection;return q;}
  async get(){
    const res=this.group?await this.pool.query("SELECT path,data FROM app_documents WHERE path ~ $1",[`(^|/)${this.path}/[^/]+$`]):await this.pool.query("SELECT path,data FROM app_documents WHERE path LIKE $1 AND array_length(string_to_array(path,'/'),1)=array_length(string_to_array($2,'/'),1)+1",[`${this.path}/%`,this.path]);
    let rows=res.rows.map(r=>({path:r.path as string,id:String(r.path).split("/").at(-1)!,data:r.data as Record<string,unknown>}));
    rows=rows.filter(r=>this.filters.every(({field:f,op,value})=>{const a=valueAt(r.id,r.data,f),v=f==="__name__"&&isObject(value)&&"id"in value?(value as {id:unknown}).id:value;switch(op){case"==":return f==="__name__"?r.id===String(v):equal(a,v);case"!=":return a!==undefined&&!equal(a,v);case">":return cmp(a,v)>0;case">=":return cmp(a,v)>=0;case"<":return cmp(a,v)<0;case"<=":return cmp(a,v)<=0;case"in":return Array.isArray(value)&&value.some(x=>f==="__name__"?r.id===String(isObject(x)&&"id"in x?x.id:x):equal(a,x));case"array-contains":return Array.isArray(a)&&a.some(x=>equal(x,v));default:throw new Error(`Unsupported query operator: ${op}`);}}));
    rows.sort((a,b)=>{for(const o of this.orders){const c=cmp(valueAt(a.id,a.data,o.field),valueAt(b.id,b.data,o.field));if(c)return o.direction==="desc"?-c:c;}return a.id.localeCompare(b.id);});
    if(this.cursor)rows=rows.filter(r=>{for(let i=0;i<this.orders.length;i++){const o=this.orders[i],c=cmp(valueAt(r.id,r.data,o.field),this.cursor!.values[i]);if(c)return o.direction==="desc"?c<0:c>0;}return r.id.localeCompare(this.cursor!.id)>0;});
    if(this.maximum!==undefined)rows=rows.slice(0,this.maximum);
    return new RtdbQuerySnapshot(rows.map(r=>{const ref=new RtdbDocumentReference(this.pool,r.path);let data=r.data;if(this.projection){data={};for(const f of this.projection){const v=field(r.data,f);if(v!==undefined)setField(data,f,v);}}return new RtdbDocumentSnapshot(ref,data);}));
  }
}
export class RtdbCollectionReference extends RtdbQuery {
  readonly id:string;readonly parent:RtdbDocumentReference|null;
  constructor(pool:Pool,path:string){super(pool,cleanPath(path));const p=this.path.split("/");this.id=p.at(-1)!;this.parent=p.length>1?new RtdbDocumentReference(pool,p.slice(0,-1).join("/")):null;}
  doc(id: string = randomUUID()){return new RtdbDocumentReference(this.pool,`${this.path}/${id}`);}
  async add(data:unknown){const ref=this.doc();await ref.create(data);return ref;}
}
class RtdbTransaction {
  readonly reads=new Map<string,unknown>();readonly operations:Operation[]=[];constructor(private readonly pool:Pool){}
  async get(ref:RtdbDocumentReference):Promise<RtdbDocumentSnapshot>;async get(ref:RtdbQuery):Promise<RtdbQuerySnapshot>;async get(ref:RtdbDocumentReference|RtdbQuery){if(ref instanceof RtdbQuery){const s=await ref.get();for(const d of s.docs)this.reads.set(d.ref.path,d.data()??null);return s;}const s=await ref.get();this.reads.set(ref.path,s.data()??null);return s;}
  set(r:RtdbDocumentReference,data:unknown,o?:{merge?:boolean}){this.operations.push({kind:"set",path:r.path,data,merge:o?.merge});return this;}create(r:RtdbDocumentReference,data:unknown){this.operations.push({kind:"create",path:r.path,data});return this;}update(r:RtdbDocumentReference,data:unknown){this.operations.push({kind:"update",path:r.path,data});return this;}delete(r:RtdbDocumentReference){this.operations.push({kind:"delete",path:r.path});return this;}
}
export class RtdbFirestoreCompat {
  constructor(private readonly pool:Pool){}
  collection(path:string){return new RtdbCollectionReference(this.pool,path);}doc(path:string){return new RtdbDocumentReference(this.pool,path);}collectionGroup(name:string){return new RtdbQuery(this.pool,name,true);}
  async getAll(...refs:RtdbDocumentReference[]){return Promise.all(refs.map(r=>r.get()));}
  batch(){const ops:Operation[]=[];const b={set:(r:RtdbDocumentReference,d:unknown,o?:{merge?:boolean})=>{ops.push({kind:"set",path:r.path,data:d,merge:o?.merge});return b;},create:(r:RtdbDocumentReference,d:unknown)=>{ops.push({kind:"create",path:r.path,data:d});return b;},update:(r:RtdbDocumentReference,d:unknown)=>{ops.push({kind:"update",path:r.path,data:d});return b;},delete:(r:RtdbDocumentReference)=>{ops.push({kind:"delete",path:r.path});return b;},commit:()=>this.commit(ops)};return b;}
  bulkWriter(){const ops:Operation[]=[];const w={set:(r:RtdbDocumentReference,d:unknown,o?:{merge?:boolean})=>{ops.push({kind:"set",path:r.path,data:d,merge:o?.merge});return w;},create:(r:RtdbDocumentReference,d:unknown)=>{ops.push({kind:"create",path:r.path,data:d});return w;},update:(r:RtdbDocumentReference,d:unknown)=>{ops.push({kind:"update",path:r.path,data:d});return w;},delete:(r:RtdbDocumentReference)=>{ops.push({kind:"delete",path:r.path});return w;},close:()=>this.commit(ops)};return w;}
  async runTransaction<T>(callback:(tx:RtdbTransaction)=>Promise<T>|T):Promise<T>{const tx=new RtdbTransaction(this.pool);const result=await callback(tx);await this.commit(tx.operations,tx.reads);return result;}
  private async commit(ops:Operation[],reads?:Map<string,unknown>){const c=await this.pool.connect();try{await c.query("BEGIN ISOLATION LEVEL SERIALIZABLE");for(const[path,expected]of reads??[]){const r=await c.query("SELECT data FROM app_documents WHERE path=$1 FOR UPDATE",[path]);if(!equal(r.rows[0]?.data??null,expected))throw new Error("Transaction conflict; retry the operation.");}for(const op of ops){const current=(await c.query("SELECT data FROM app_documents WHERE path=$1 FOR UPDATE",[op.path])).rows[0]?.data??null;if(op.kind==="delete"){await c.query("DELETE FROM app_documents WHERE path=$1 OR left(path,length($1)+1)=$1 || '/'",[op.path]);continue;}if(op.kind==="create"&&current!==null)throw new Error("ALREADY_EXISTS");if(op.kind==="update"&&current===null)throw new Error("NOT_FOUND");const value=op.kind==="update"?applyUpdate(current,op.data):op.merge?mergeData(current,op.data):materialize(op.data);await c.query("INSERT INTO app_documents(path,data) VALUES($1,$2) ON CONFLICT(path) DO UPDATE SET data=EXCLUDED.data,updated_at=now()",[op.path,JSON.stringify(value)]);}await c.query("COMMIT");}catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}}
}
export function createRtdbFirestoreCompat(pool: Pool | unknown){return new RtdbFirestoreCompat(pool as Pool);}
