import {afterAll,describe,it,expect} from 'vitest';
import {randomUUID,createHash,randomBytes} from 'node:crypto';
import pg from 'pg';
import {CommunityApplication} from '../src/comunidad/application/use-cases.js';
import {PostgresCommunityRepository} from '../src/comunidad/infrastructure/postgres-community.js';

const suite=process.env.TEST_POSTGRES==='1'?describe:describe.skip;
suite('Community invitation views and report ownership (PostgreSQL)',()=>{
  const pool=new pg.Pool({host:process.env.POSTGRES_HOST??'127.0.0.1',port:Number(process.env.POSTGRES_PORT??5432),database:process.env.COMUNIDAD_DB,user:process.env.COMUNIDAD_USER,password:process.env.COMUNIDAD_PASSWORD,max:2});
  const repo=new PostgresCommunityRepository(pool),leader=randomUUID(),participant=randomUUID(),foreign=randomUUID(),workspaceId=randomUUID(),groups:string[]=[],reservations:string[]=[];
  const app=new CommunityApplication(repo,{ownsWorkspace:async()=>false});
  afterAll(async()=>{if(groups.length){await pool.query('DELETE FROM community.espacio_trabajo_grupo WHERE grupo_id=ANY($1::uuid[])',[groups]);await pool.query('DELETE FROM community.invitacion_grupo WHERE grupo_id=ANY($1::uuid[])',[groups]);await pool.query('DELETE FROM community.membresia_grupo WHERE grupo_id=ANY($1::uuid[])',[groups]);await pool.query('DELETE FROM community.grupo WHERE grupo_id=ANY($1::uuid[])',[groups]);}if(reservations.length)await pool.query('DELETE FROM community.reserva WHERE reserva_id=ANY($1::uuid[])',[reservations]);await pool.query('DELETE FROM community.write_idempotency WHERE actor_id=ANY($1::uuid[])',[[leader,participant,foreign]]);await pool.end();});
  it('lists invitation metadata only for local leaders and never exposes bearer hashes',async()=>{
    const created=await repo.createGroup(leader,'Synthetic invitation group',null,randomUUID());const groupId=(created.item as {id:string}).id;groups.push(groupId);
    const hash=createHash('sha256').update(randomBytes(32)).digest('hex');const invitation=await app.createInvitation(groupId,leader,'synthetic@example.invalid',hash,new Date(Date.now()+60000));expect(invitation.id).toMatch(/^[0-9a-f-]{36}$/);const result=await app.listInvitations(groupId,leader,25,0);expect(result.items).toHaveLength(1);expect(result.items[0]).toMatchObject({id:invitation.id,email:'synthetic@example.invalid',status:'pending'});expect(JSON.stringify(result)).not.toContain(hash);await expect(app.listInvitations(groupId,foreign,25,0)).rejects.toMatchObject({code:'FORBIDDEN'});await repo.acceptInvitation(participant,'synthetic@example.invalid',hash);expect((await app.listInvitations(groupId,leader,25,0)).items[0]).toMatchObject({status:'accepted'});await expect(app.listInvitations(groupId,participant,25,0)).rejects.toMatchObject({code:'FORBIDDEN'});
  });
  it('limits report snapshots to shared group leadership, workspace and saved versions',async()=>{
    const groupId=groups[0];await repo.shareWorkspace(groupId,leader,workspaceId);const created=await pool.query("INSERT INTO community.reserva(espacio_id,creada_por,servicio_etiqueta,fecha,hora,estado,version) VALUES($1,$2,'Synthetic',current_date+2,'12:00','confirmed',3) RETURNING reserva_id AS id",[workspaceId,participant]);const id=created.rows[0].id;reservations.push(id);expect(await app.canReportWorkspace(leader,workspaceId)).toBe(true);expect(await app.canReportWorkspace(participant,workspaceId)).toBe(false);const result=await app.snapshotReservations(leader,workspaceId,[id]);expect(result.items).toMatchObject([{source:'reservation',id,version:3,data:{workspaceId,createdBy:participant}}]);await expect(app.snapshotReservations(foreign,workspaceId,[id])).rejects.toMatchObject({code:'NOT_FOUND'});await repo.revokeWorkspace(groupId,leader,workspaceId);expect(await app.canReportWorkspace(leader,workspaceId)).toBe(false);await expect(app.snapshotReservations(leader,workspaceId,[id])).rejects.toMatchObject({code:'NOT_FOUND'});
  });
});
