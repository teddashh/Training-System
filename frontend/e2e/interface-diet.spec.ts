import {test, expect, type Page} from '@playwright/test';
import type {Access, Course, CourseSession, User} from '../src/types';
import {navigateArea, registrationActionLayout} from './navigation';
const url = (path: string) => (process.env.E2E_SUBPATH || '') + path;
const learner: Access = {courses:'none',exams:'none',results:'none',assign:false,invitations:false,system_admin:false,people:false,scorm_upload:false,scorm_source:false};
const scheduler: Access = {...learner,courses:'own',exams:'own'};
const admin: Access = {...scheduler,courses:'all',exams:'all',results:'all',assign:true,invitations:true,system_admin:true,people:true};
const person = (access: Access): User => ({id:901,username:'synthetic-learner',display_name:'Synthetic Learner',email:'learner@example.test',role:'learner',access,employment:'employee',department:'Synthetic',employee_id:null});
const dashboard = {people:0,courses:0,completion:0,enrollments:0,completed:0,pass_rate:0,average_score:0,graded_count:0,pending:0,employee_count:0,contractor_count:0,days:30,trend:[],departments:[],distribution:[0,0,0,0,0]};
async function mockShell(page: Page, access: Access) {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/auth/session/') ? {user:person(access),entra_enabled:false,demo_mode:false} : path.includes('/dashboard/') ? dashboard : [];
    return route.fulfill({json:data});
  });
}
for (const width of [390,768,1440]) {
  test(`areas and personal home at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:900});
    for (const [access, areas] of [[learner,['Home','My training']],[scheduler,['Home','My training','Training','Exams']],[admin,['Home','My training','Training','Exams','Reports','People','Settings']]] as const) {
      await page.unroute('**/api/**');
      await mockShell(page,access);
      await page.goto(url('/'));
      await expect(page.getByRole('heading',{name:'Welcome back, Synthetic Learner.',exact:true})).toBeVisible();
      await expect(page.locator('.stat-card, .chart-area, .welcome-banner')).toHaveCount(0);
      await expect(page.getByRole('heading', {name:'Upcoming sessions',exact:true})).toHaveCount(0);
      await expect(page.getByRole('heading', {name:'Needs attention',exact:true})).toHaveCount(0);
      await expect(page.getByText("You're all caught up.",{exact:true})).toBeVisible();
      if (access === learner) {
        await expect(page.locator('.personal-progress progress')).toHaveCount(0);
      }
      const nav = page.getByRole('navigation',{name:'Main navigation',exact:true});
      await expect(nav.getByRole('link')).toHaveText([...areas]);
      await navigateArea(page,'My training');
      const tabs=page.locator('.area-tabs');
      await expect(tabs.getByRole('link')).toHaveText(access.results==='none'?['Training','Exams','Results','Catalog']:['Training','Exams','Catalog']);
      await expect(tabs.getByRole('link',{name:'Training',exact:true})).toHaveAttribute('aria-current','page');
      for(const link of await tabs.getByRole('link').all())expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await tabs.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      if(access===admin){
        await navigateArea(page,'Reports');
        await expect(page.getByRole('heading',{name:'Training overview',exact:true})).toBeVisible();
        await expect(page.locator('.stat-card')).toHaveCount(4);
        await expect(page.locator('.area-tabs').getByRole('link').first()).toHaveText('Overview');
      }
      if(access===scheduler){
        // No Reports area without the results capability: the overview stays one quiet link away.
        await navigateArea(page,'Home');
        await page.getByRole('link',{name:'Statistics',exact:true}).click();
        await expect(page.getByRole('heading',{name:'Training overview',exact:true})).toBeVisible();
        await expect(page.locator('.stat-card')).toHaveCount(4);
        await expect(page.locator('.area-tabs')).toHaveCount(0);
      }
      if(access===admin){
        await navigateArea(page,'Training','Assignments');
        await expect(page).toHaveURL(new RegExp('/assignments$'));
        await expect(nav.getByRole('link',{name:'Training',exact:true})).toHaveAttribute('aria-current','page');
      }
    }
  });
}
function session(id:number):CourseSession {
  const start=Date.now()+id*86400000;
  return {id,title:`Synthetic session ${id}`,revision:1,location:'Synthetic room',registration_opens_at:null,registration_closes_at:new Date(start).toISOString(),starts_at:new Date(start).toISOString(),ends_at:new Date(start+3600000).toISOString(),capacity:10,reserved:7,remaining:3,cancelled:false,state:'open'};
}
for (const width of [390,768,1440]) test(`registration stays in place at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  let signedIn=false, selected:number|null=null, revision=0, refused=false;
  const posts:string[]=[];
  const sessions=[session(1),session(2),{...session(3),state:'upcoming' as const,registration_opens_at:new Date(Date.now()+86400000).toISOString()}];
  const course:Course={id:901,title:'Synthetic training',description:'A short synthetic description.',category:'Synthetic',cover:'learning-skills',duration_minutes:180,delivery_mode:'scheduled',venue:'onsite',requires_approval:false,published:true,release_at:null,sessions,assessments:[],server_time:new Date().toISOString(),enrollment:null,can_learn:false,can_manage:false,blocks:[],package:null,progress:null,enrolled_count:0};
  const enrollment=()=>selected?{id:900,status:'approved',session:sessions.find(s=>s.id===selected),revision,completed_at:null}:null;
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    let data:unknown=[];
    if(path.endsWith('/auth/session/'))data={user:signedIn?person(learner):null,entra_enabled:false};
    else if(path.endsWith('/registration/lookup/'))data={
      id:course.id,title:course.title,description:course.description,category:course.category,cover:course.cover,
      duration_minutes:course.duration_minutes,delivery_mode:course.delivery_mode,venue:course.venue,requires_approval:course.requires_approval,
      sessions:sessions.map(s=>({id:s.id,title:s.title,starts_at:s.starts_at,ends_at:s.ends_at,location:s.location,state:s.state,seats_remain:true,
        seats_left:s.id===1?3:null,...(s.state==='upcoming'?{registration_opens_at:s.registration_opens_at}:{})})),
      ...(signedIn?{enrollment:selected?{status:'approved',session:selected}:null}:{})};
    else if(path.endsWith('/enroll/')){
      posts.push(path);
      if(refused)return route.fulfill({status:409,json:{detail:'Synthetic session is full.'}});
      selected=route.request().postDataJSON().session;revision++;data=enrollment();
    }else if(path.endsWith('/courses/901/'))data={...course,enrollment:enrollment()};
    return route.fulfill({json:data});
  });
  await page.goto(url('/register#synthetic-registration'));
  await expect(page.getByRole('heading',{level:1})).toHaveText(course.title);
  await expect(page.locator('.guest-brand, .course-intro-facts')).toHaveCount(0);
  await expect(page.getByRole('radio').first()).toBeChecked();
  await expect(page.getByText('3 seats left',{exact:true})).toHaveCount(1);
  await expect(page.locator('.session-card').last()).toContainText('Opens ');
  await expect(page.getByRole('radio').last()).toBeDisabled();
  expect((await page.locator('.course-cover').boundingBox())!.height).toBeLessThanOrEqual(260);
  await registrationActionLayout(page);
  await page.getByRole('button',{name:'Register',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Sign in to register',exact:true})).toBeVisible();
  signedIn=true;
  await page.reload();
  await page.getByRole('button',{name:'Register',exact:true}).click();
  await expect(page.getByRole('status')).toContainText("You're registered");
  await expect(page.locator('.session-card.is-reserved')).toContainText('Synthetic session 1');
  await expect(page.locator('.session-card.is-reserved').getByRole('button',{name:'Add to calendar'})).toBeVisible();
  refused=true;
  await page.getByRole('button',{name:'Switch to this session',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic session is full.');
  await expect(page.locator('.session-card.is-reserved')).toContainText('Synthetic session 1');
  refused=false;
  await page.getByRole('button',{name:'Switch to this session',exact:true}).click();
  await expect(page.locator('.session-card.is-reserved')).toContainText('Synthetic session 2');
  expect(posts).toHaveLength(3);
  expect(posts.every(path=>path.endsWith('/enroll/'))).toBe(true);
  await expect(page.getByRole('link',{name:'Go to my training'})).toHaveAttribute('href',url('/my-training'));
  await expect(page).toHaveURL(/\/register#synthetic-registration$/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

function managedCourse(id: number, sessions: CourseSession[], canManage = true): Course {
  return {id,title:`Synthetic training ${id}`,description:'',category:'',cover:'learning-skills',duration_minutes:60,
    delivery_mode:'scheduled',venue:'onsite',requires_approval:true,published:true,release_at:null,sessions,
    assessments:[],server_time:new Date().toISOString(),enrollment:null,can_learn:false,can_manage:canManage,
    blocks:[],package:null,progress:null,enrolled_count:0};
}
test('home uses managed sessions and real pending requests; reports retain filters', async ({page}) => {
  await mockShell(page, scheduler);
  const courses = [managedCourse(901,[session(9),session(1),session(4),session(7)]),
    managedCourse(902,[session(6),session(3),{...session(2),cancelled:true}]), managedCourse(903,[session(1)],false)];
  let pending = 2;
  await page.route('**/api/courses/',route=>route.fulfill({json:courses}));
  await page.route('**/api/courses/*/enrollments/?status=pending',route=>route.fulfill({json:{count:route.request().url().includes('/901/')?pending:0,results:[]}}));
  await page.goto(url('/'));
  await expect(page.getByRole('link',{name:'New training',exact:true})).toHaveAttribute('href',url('/authoring/new'));
  const upcoming=page.locator('.home-actions').filter({has:page.getByRole('heading',{name:'Upcoming sessions',exact:true})});
  await expect(upcoming.getByRole('link')).toHaveCount(5);
  await expect(upcoming.locator('strong')).toHaveText(['Synthetic training 901','Synthetic training 902','Synthetic training 901','Synthetic training 902','Synthetic training 901']);
  await expect(upcoming.getByRole('link').first()).toHaveAttribute('href',url('/authoring/901'));
  await expect(upcoming.getByRole('link').first()).toContainText('7 of 10');
  const attention=page.locator('.home-actions').filter({has:page.getByRole('heading',{name:'Needs attention',exact:true})});
  await expect(attention.getByRole('link')).toHaveCount(1);
  await expect(attention.getByRole('link')).toContainText('2 requests');
  await expect(attention.getByRole('link')).toHaveAttribute('href',url('/authoring/901?tab=people&status=pending'));
  pending=0;
  await page.reload();
  await expect(upcoming).toBeVisible();
  await expect(attention).toHaveCount(0);
  // A scheduler has no Reports area; the organisation overview is one quiet link below the home blocks.
  await page.getByRole('link',{name:'Statistics',exact:true}).click();
  await expect(page).toHaveURL(url('/reports'));
  await page.getByLabel('Reporting period').selectOption('7');
  await expect(page.getByRole('heading',{name:'Score distribution',exact:true})).toBeVisible();
});

test('manager exams combine drafts and published rows with one visible action',async({page})=>{
  await mockShell(page,admin);
  const exams=Array.from({length:9},(_,i)=>({id:i+1,title:`Synthetic exam ${i+1}`,description:'Synthetic instructions.',
    published:i>0,can_manage:true,can_view_results:true,available_to_me:true,question_count:2,courses:[],course_links:[],
    audience:'all',starts_at:null,ends_at:i===2?'2020-01-01T00:00:00Z':null,active_attempt_id:null,last_result:null,
    attempts_remaining:2,effective_attempt_limit:2,max_attempts:2,attempts_used:0,duration_minutes:30,pass_score:70,
    server_time:new Date().toISOString()}));
  let rows=exams;
  await page.route('**/api/exams/',route=>route.fulfill({json:rows}));
  await page.goto(url('/exams?view=library'));
  await expect(page.locator('.exam-card')).toHaveCount(9);
  await expect(page.getByRole('button',{name:'New exam',exact:true})).toBeVisible();
  await expect(page.locator('main .btn.primary')).toHaveCount(1);
  await expect(page.locator('.summary-strip, main .tabs')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Start / resume',exact:true})).toHaveCount(0);
  await expect(page.getByLabel('Search exams')).toBeVisible();
  await expect(page.locator('.exam-card').first()).toContainText('Draft');
  const published=page.locator('.exam-card').nth(1);
  await expect(published.locator('.badge')).toHaveCount(0);
  await expect(published.getByRole('button')).toHaveText(['Edit']);
  await expect(page.locator('.exam-card').nth(2)).toContainText('Assessment closed');
  await published.locator('summary').click();
  await expect(published.getByRole('button')).toHaveText(['Edit','Preview exam','Live exam monitor','Individual attempt limits','Invite guest','Delete exam']);
  await page.keyboard.press('Escape');
  await expect(published.locator('summary')).toBeFocused();
  await expect(published.getByRole('button')).toHaveText(['Edit']);
  await page.getByLabel('Search exams').fill('exam 9');
  await expect(page.locator('.exam-card')).toHaveCount(1);
  rows=exams.slice(0,8);
  await page.reload();
  await expect(page.locator('.exam-card')).toHaveCount(8);
  await expect(page.getByLabel('Search exams')).toHaveCount(0);
});
