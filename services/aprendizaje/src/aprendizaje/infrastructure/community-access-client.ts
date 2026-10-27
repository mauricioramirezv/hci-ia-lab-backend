import type { GroupAccessPort } from '../application/workflows.js';
import { IdentityUnavailable } from '../application/session.js';
export class CommunityAccessHttpClient implements GroupAccessPort {
  constructor(private readonly baseUrl: string, private readonly token?: string) {}
  async membership(groupId: string, accountId: string) {
    if (!this.token) throw new IdentityUnavailable();
    let response: Response;
    try {
      response = await fetch(this.baseUrl + '/internal/v1/groups/' + encodeURIComponent(groupId) + '/members/' + encodeURIComponent(accountId), {
        headers: { 'x-identity-internal-token': this.token }, signal: AbortSignal.timeout(1500),
      });
    } catch { throw new IdentityUnavailable(); }
    if (!response.ok) throw new IdentityUnavailable();
    return await response.json() as { active: boolean; role: 'leader' | 'participant' | null };
  }

  async canReportWorkspace(accountId:string,workspaceId:string){
    if(!this.token)throw new IdentityUnavailable();
    let response:Response;
    try{response=await fetch(this.baseUrl+'/internal/v1/workspaces/report-authorize',{method:'POST',headers:{'content-type':'application/json','x-identity-internal-token':this.token},body:JSON.stringify({accountId,workspaceId}),signal:AbortSignal.timeout(1500)});}catch{throw new IdentityUnavailable();}
    if(!response.ok)throw new IdentityUnavailable();
    const result=await response.json() as {allowed?:unknown};
    if(typeof result.allowed!=='boolean')throw new IdentityUnavailable();
    return result.allowed;
  }
}
