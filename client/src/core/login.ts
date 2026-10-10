// Keep email validation aligned with the API; validate before issuing any request.
export function loginRequest(action:'code'|'login'|'logout',email:string,code:string):Record<string,string>{
 if(action==='logout')return {};
 const normalized=email.trim().toLowerCase();
 if(!normalized)throw new Error('请先填写邮箱地址');
 if(normalized.length>254||!/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(normalized))throw new Error('请输入有效的邮箱地址，例如 name@example.com');
 if(action==='code')return {email:normalized};
 if(!code)throw new Error('请输入邮件里的6位验证码');
 if(!/^\d{6}$/.test(code))throw new Error('验证码须为6位数字');
 return {email:normalized,code};
}
