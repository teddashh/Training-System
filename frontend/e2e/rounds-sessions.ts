import { moreOptions, registrationActionLayout } from "./navigation";
import {expect,type Browser,type Page} from '@playwright/test';
const url=(path:string)=>(process.env.E2E_SUBPATH||'')+path;
async function write(page:Page,path:string,data:unknown,method='POST'){
  const csrf=(await page.context().cookies()).find(c=>/^(?:__Host-)?training_csrf$/.test(c.name))!.value;
  const r=await page.request.fetch(url('/api/'+path),{method,headers:{'X-CSRFToken':csrf},data});
  expect(r.ok(),await r.text()).toBeTruthy();return r.json();
}
export async function roundsSessionsWorkflow(page:Page,browser:Browser){
  await page.setViewportSize({width:1440,height:1000});
  const stamp=Date.now(),title=`Session workflow ${stamp}`;
  const course=await write(page,'courses/',{title,published:true,delivery_mode:'scheduled',blocks:[{type:'text',text:'A timed lesson.'}]});
  const exam=await write(page,'exams/',{title:`Round workflow ${stamp}`,questions:[{type:'single',description:'Select the correct answer.',options:['Yes','No'],solution:[0],points:100,position:0}]});
  await page.goto(url('/exams'));
  await expect(page.locator('.exam-card').filter({hasText:exam.title})).toContainText('Draft');
  await page.getByRole('button',{name:`Edit ${exam.title}`,exact:true}).click();
  await moreOptions(page);
  await page.getByLabel('Renew failed rounds',{exact:true}).check();
  await page.getByLabel('Attempts per round',{exact:true}).fill('2');
  await page.getByRole('combobox',{name:'Waiting period unit',exact:true}).selectOption('1440');
  await page.getByLabel('Renewal wait',{exact:true}).fill('3');
  await page.getByRole('button',{name:'Save exam',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Edit exam',exact:true})).toHaveCount(0);
  expect((await (await page.request.get(url(`/api/exams/${exam.id}/`))).json()).attempt_reset_minutes).toBe(4320);
  await page.goto(url('/courses'));
  const card=page.locator('.course-card').filter({has:page.getByRole('heading',{name:title,exact:true})});
  await card.getByRole('button',{name:`Edit ${title}`,exact:true}).click();
  for(const [name,offset] of [['Morning',1],['Afternoon',3]] as const){
    await page.getByRole('button',{name:'Add session',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Add session',exact:true});
    const local=(hours:number)=>{const d=new Date(Date.now()+hours*3600000);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
    await dialog.getByLabel('Session name',{exact:true}).fill(name);
    await dialog.getByLabel('Session starts',{exact:true}).fill(local(offset));
    await dialog.getByLabel('Session ends',{exact:true}).fill(local(offset+1));
    await dialog.getByLabel('Seat limit',{exact:true}).fill('1');
    await dialog.getByRole('button',{name:'Save session',exact:true}).click();
    await expect(dialog).toHaveCount(0);
  }
  await expect(page.locator('.session-row')).toHaveCount(2);
  // Managers reveal the shareable link in the course editor; learners never see it in the session list.
  const editor=page.getByRole('dialog',{name:'Edit course details',exact:true});
  await moreOptions(page);
  await editor.getByRole('button',{name:'Show registration link',exact:true}).click();
  await expect(editor.getByLabel('Registration link',{exact:true})).toHaveValue(new RegExp('^'+new URL(url('/register'),page.url()).href.replace(/[.?*+^$()[\]{}|\\/]/g,'\\$&')+'#[A-Za-z0-9_-]{43}$'));
  await editor.getByRole('button',{name:'Close',exact:true}).click();
  await card.getByRole('button',{name:'View sessions',exact:true}).click();
  await expect(page.getByLabel('Registration link',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('dialog',{name:'Choose a session',exact:true}).getByRole('button',{name:'Start learning',exact:true})).toHaveCount(0);
  await page.getByRole('dialog',{name:'Choose a session',exact:true}).getByRole('button',{name:'Close',exact:true}).first().click();
  // The password must not resemble the username: with some timestamps the old one crossed the similarity limit.
  const username=`session-browser-${stamp}`,password='Quiet-Harbor-Lamp-77!';
  await write(page,'users/',{username,email:username+'@example.test',password,display_name:'Session Browser',role:'learner'});
  const context=await browser.newContext({baseURL:new URL(page.url()).origin});const learner=await context.newPage();
  try{
    await learner.goto(url(`/courses?course=${course.id}&action=register`));
    // The initial session request installs CSRF; navigation alone does not wait
    // for that request when the application is served by the Vite CI server.
    await expect(learner.getByLabel('Email, username or employee ID')).toBeVisible();
    await learner.getByLabel('Email, username or employee ID').fill(username);
    await learner.getByLabel('Password',{exact:true}).fill(password);
    await learner.getByRole('button',{name:'Sign in to workspace',exact:true}).click();
    const sessionDialog=learner.getByRole('dialog');
    const morning=sessionDialog.locator('.session-row').filter({hasText:'Morning'}),afternoon=sessionDialog.locator('.session-row').filter({hasText:'Afternoon'});
    await expect(morning.getByRole('radio')).toBeChecked();
    for(const width of [390,768,1440]) {await learner.setViewportSize({width,height:900}); await registrationActionLayout(learner);}
    await sessionDialog.getByRole('button',{name:'Register',exact:true}).click();
    await expect(morning.getByRole('button',{name:'Cancel registration',exact:true})).toBeVisible();
    await expect(morning).toContainText('Full');
    await expect(sessionDialog).toContainText("You're registered");
    await afternoon.getByRole('button',{name:'Switch to this session',exact:true}).click();
    await expect(afternoon.getByRole('button',{name:'Cancel registration',exact:true})).toBeVisible();
    await expect(morning).toContainText('1 seat left');
    await expect(morning.getByRole('button',{name:'Switch to this session',exact:true})).toBeEnabled();
    await expect(sessionDialog.getByRole('button',{name:'Start learning',exact:true})).toHaveCount(0);
    for(const width of [1440,768,390]){await learner.setViewportSize({width,height:900});expect(await learner.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
    const data=await (await page.request.get(url(`/api/courses/${course.id}/sessions/`))).json();
    expect(data.map((s:{reserved:number})=>s.reserved)).toEqual([0,1]);
  }finally{await context.close();}
}
