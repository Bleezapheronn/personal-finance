import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AUTHORITY_OPS_PROFILE_SCHEMA_VERSION, writeAuthorityOpsProfileAtomic, type AuthorityOpsProfile } from "./lib/authorityOpsProfile.js";
import os from "node:os";
import { acquireAuthorityOpsLock, lockPathForProfile } from "./lib/authorityOpsLock.js";
import { backupStatusPathForProfile, createRetentionPlan, initializeBackupSettings, inventoryScheduledBackups, readBackupSettings, runScheduledSqliteBackup, updateBackupSettings, validateBackupDestination } from "./lib/scheduledSqliteBackup.js";
import { serverRoot } from "./lib/paths.js";
import { readSqliteLogicalVerificationAtPath } from "./lib/sqliteLogicalVerification.js";

const checks: Array<{name:string;ok:boolean}> = [];
function assert(value: unknown): asserts value { if (!value) throw new Error("assertion_failed"); }
const expectFailure = async (fn: () => unknown | Promise<unknown>, code: string) => { try { await fn(); } catch (e) { assert(e instanceof Error && e.message.includes(code)); return; } throw new Error("expected_failure"); };
const check = async (name:string, fn:()=>unknown|Promise<unknown>) => { try { await fn(); checks.push({name,ok:true}); } catch { checks.push({name,ok:false}); } };
const makeDb = (file:string) => { const db=new Database(file); try { db.exec(readFileSync(path.join(serverRoot,"schema","prototype-schema.sql"),"utf8")); } finally { db.close(); } };

const main = async () => {
  const root=mkdtempSync(path.join(tmpdir(),"pf-scheduled-backup-test-")); const oldDataRoot=process.env.PERSONAL_FINANCE_DATA_ROOT;
  try {
    const runtime=path.join(root,"runtime"); const checkpoint=path.join(root,"checkpoints"); const configRoot=path.join(root,"data"); const destination=path.join(root,"destination"); const staging=path.join(root,"staging"); const sqlite=path.join(runtime,"active.sqlite"); const token=path.join(root,"token"); const profilePath=path.join(root,"profiles","authority-profile.json");
    mkdirSync(runtime,{recursive:true}); mkdirSync(checkpoint,{recursive:true}); writeFileSync(token,"test-token"); makeDb(sqlite);
    const profile:AuthorityOpsProfile={schemaVersion:AUTHORITY_OPS_PROFILE_SCHEMA_VERSION,mode:"rehearsal",activeDatabasePath:sqlite,authorityManifestPath:null,sourceBackupPath:null,tokenFilePath:token,backupDirectory:checkpoint,apiHost:"127.0.0.1",apiPort:3160,viteHost:"localhost",vitePort:5173,enabledWriteCapabilities:[]};
    writeAuthorityOpsProfileAtomic(profilePath,profile,{allowRepoPathsForTests:true}); process.env.PERSONAL_FINANCE_DATA_ROOT=configRoot;
    await check("configuration initializes atomically outside SQLite",()=>{ const settings=initializeBackupSettings(profilePath,{destinationDirectory:destination,stagingDirectory:staging,taskName:"PF disposable backup test"}); assert(existsSync(destination)&&existsSync(staging)&&settings.enabled===false); });
    await check("configuration rejects active database and checkpoint destinations",async()=>{ await expectFailure(()=>validateBackupDestination(profilePath,sqlite),"backup_destination_active_database"); await expectFailure(()=>validateBackupDestination(profilePath,checkpoint),"backup_destination_checkpoint_directory"); });
    await check("configuration updates retain strict fixed policy",()=>{ const settings=updateBackupSettings(profilePath,{enabled:true,dailyLocalTime:"03:45"}); assert(settings.dailyRetentionDays===30&&settings.monthlyRetentionEnabled&&readBackupSettings(profilePath).dailyLocalTime==="03:45"); });
    let first="";
    await check("backup succeeds while a writer connection is active",async()=>{ const writer=new Database(sqlite); try { const result=await runScheduledSqliteBackup(profilePath); first=result.basename; assert(existsSync(path.join(destination,"Daily",result.basename))); } finally { writer.close(); } });
    await check("inventory verifies checksum and staged restore publication",()=>{ const rows=inventoryScheduledBackups(profilePath); assert(rows.length===1&&rows[0].valid&&rows[0].basename===first); });
    await check("incomplete partial publication is ignored",()=>{ writeFileSync(path.join(destination,"Daily","ignored.sqlite.partial"),"partial"); const rows=inventoryScheduledBackups(profilePath); assert(rows.every(x=>!x.basename.includes("ignored"))); });
    await check("filename collision refuses overwrite",async()=>{ await expectFailure(()=>runScheduledSqliteBackup(profilePath),"scheduled_backup_filename_collision"); });
    await check("concurrent backup lock is refused",async()=>{ const release=acquireAuthorityOpsLock(profilePath,"test-held-lock"); try { await expectFailure(()=>runScheduledSqliteBackup(profilePath),"authority_ops_lock_held"); } finally { release(); } });
    await check("lock-held failure still records attempted and failure status", async()=>{ const release=acquireAuthorityOpsLock(profilePath,"test-held-lock"); try { await expectFailure(()=>runScheduledSqliteBackup(profilePath),"authority_ops_lock_held"); } finally { release(); } const status=JSON.parse(readFileSync(backupStatusPathForProfile(profilePath),"utf8")) as {lastAttemptedAt?:string;lastResultCode?:string}; assert(typeof status.lastAttemptedAt==="string"&&status.lastResultCode==="authority_ops_lock_held"); });
    await check("stale lock is recovered for scheduled backup", async()=>{ const lockPath=lockPathForProfile(profilePath); writeFileSync(lockPath, `${JSON.stringify({processId:2_147_483_647,hostname:os.hostname(),command:"run",startedAt:new Date().toISOString()},null,2)}\n`, "utf8"); const result=await runScheduledSqliteBackup(profilePath,"monthly"); assert(result.basename.endsWith(".sqlite")); assert(!existsSync(lockPath)); });
    await check("corrupt manifest and missing pair are invalid",()=>{ const row=inventoryScheduledBackups(profilePath)[0]; const saved=readFileSync(row.manifestPath,"utf8"); writeFileSync(row.manifestPath,"not-json"); assert(inventoryScheduledBackups(profilePath).some(x=>!x.valid)); writeFileSync(row.manifestPath,saved); unlinkSync(row.databasePath); assert(inventoryScheduledBackups(profilePath).some(x=>x.reason==="missing_database")); });
    await check("checksum mismatch is classified invalid",()=>{ const rows=inventoryScheduledBackups(profilePath); const db=rows[0].databasePath; writeFileSync(db,"tampered"); const invalid=inventoryScheduledBackups(profilePath); assert(invalid.some(x=>!x.valid)); unlinkSync(db); unlinkSync(rows[0].manifestPath); });
    // A fresh backup is used as a clean source for retention fixtures.
    const clean=await runScheduledSqliteBackup(profilePath,"monthly"); const item=inventoryScheduledBackups(profilePath).find(x=>x.basename===clean.basename); assert(item?.manifest);
    await check("retention dry run preserves newest and selects monthly representative",()=>{ const dir=path.dirname(item!.databasePath); const original=JSON.parse(readFileSync(item!.manifestPath,"utf8")); for(const day of ["2026-05-01","2026-05-02","2026-06-01","2026-06-02"]){ const base=`personal-finance-daily-${day}-fixture`; const verification=readSqliteLogicalVerificationAtPath(item!.databasePath,new Date(`${day}T12:00:00`)); const manifest={...original,createdAt:`${day}T12:00:00.000Z`,normalizedLocalDay:day,sourceDatabaseIdentityFingerprint:verification.databaseIdentityFingerprint,backupDatabaseIdentityFingerprint:verification.databaseIdentityFingerprint,schemaVersion:verification.schemaVersion,logicalVerification:verification}; copyFileSync(item!.databasePath,path.join(dir,`${base}.sqlite`)); writeFileSync(path.join(dir,`${base}.manifest.json`),JSON.stringify(manifest)); } const plan=createRetentionPlan(profilePath); assert(plan.deletes.length>=1&&plan.keeps>=3); });
    await check("retention refuses ambiguous inventory",async()=>{ const orphan=path.join(destination,"Daily","personal-finance-daily-orphan.sqlite"); mkdirSync(path.dirname(orphan),{recursive:true}); writeFileSync(orphan,"partial"); await expectFailure(()=>createRetentionPlan(profilePath),"retention_inventory_ambiguous"); });
  } finally { if(oldDataRoot===undefined) delete process.env.PERSONAL_FINANCE_DATA_ROOT; else process.env.PERSONAL_FINANCE_DATA_ROOT=oldDataRoot; rmSync(root,{recursive:true,force:true}); }
  for(const result of checks) console.log(`${result.ok?"PASS":"FAIL"} ${result.name}`); const failed=checks.filter(x=>!x.ok).length; console.log(`Scheduled SQLite backup checks: total=${checks.length} passed=${checks.length-failed} failed=${failed}`); if(failed) process.exitCode=1;
};
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
