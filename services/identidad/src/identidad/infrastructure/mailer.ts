import nodemailer from 'nodemailer';
export type IdentityMail={to:string;subject:string;link:string};
export interface Mailer{send(message:IdentityMail):Promise<void>}
export class LocalMailer implements Mailer{
 readonly messages:IdentityMail[]=[];
 async send(message:IdentityMail){this.messages.push(message);}
}
export class SmtpMailer implements Mailer{
 private readonly transport;
 constructor(url:string,from:string){this.transport=nodemailer.createTransport(url);this.from=from;}
 private readonly from:string;
 async send(message:IdentityMail){await this.transport.sendMail({from:this.from,to:message.to,subject:message.subject,text:`Abre este enlace para continuar: ${message.link}`,html:`<p>Abre este enlace para continuar:</p><p><a href="${message.link}">${message.link}</a></p>`});}
}
