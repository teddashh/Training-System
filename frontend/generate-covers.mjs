// Legacy artwork stays byte-identical. Both generators write the combined catalogue.
import { writeCatalogue } from "./cover-art/catalogue.mjs";
import fs from 'node:fs';
const groups=fs.readFileSync(new URL('../shared/brand/cover-topics.txt',import.meta.url),'utf8').trim().split('\n');
const palette=['#083957','#542247','#003636','#083957','#542247','#003636','#321A0F','#542247','#083957','#003636'];
const accents=['#52BEC7','#A91264','#3B9D8E','#52BEC7','#A91264','#3B9D8E','#A97D4E','#A91264','#52BEC7','#3B9D8E'];
const styles=['Orbit','Layers','Ripples','Grid','Ribbons','Horizon','Facets','Petals','Contours','Mosaic'];
const out=new URL('./public/covers/',import.meta.url);fs.mkdirSync(out,{recursive:true});const catalog=[];
const repeat=(n,fn)=>Array.from({length:n},(_,i)=>fn(i)).join('');
function artwork(g,n){
 const a=accents[g],offset=36*n,x=220+58*n,y=270+(n%3)*70;
 if(g===0)return repeat(7,i=>`<circle cx="${x+220}" cy="${y+80}" r="${65+i*42}" fill="none" stroke="${i%2?a:'white'}" stroke-width="${i%3===0?20:3}" opacity="${.25+i*.08}"/>`);
 if(g===1)return repeat(7,i=>`<path d="M${-240+i*190+offset} 600L${80+i*190+offset} 138H${270+i*190+offset}L${-50+i*190+offset} 600Z" fill="${i%2?a:'white'}" opacity="${.08+i*.055}"/>`);
 if(g===2)return repeat(13,i=>`<ellipse cx="${x+200}" cy="${y+120}" rx="${80+i*48}" ry="${22+i*20}" fill="none" stroke="${i%4===0?'white':a}" stroke-width="${i%4===0?6:2}" opacity=".75"/>`);
 if(g===3)return repeat(8,i=>repeat(5,j=>`<rect x="${50+i*150+(n%2)*35}" y="${160+j*95}" width="${42+((i+j+n)%3)*24}" height="${42+((i+j+n)%3)*24}" rx="${(i+n)%2?30:2}" fill="${(i+j+n)%3===0?'white':a}" opacity="${.14+((i*2+j+n)%5)*.13}"/>`));
 if(g===4)return repeat(6,i=>`<path d="M-40 ${240+i*67}C${290+offset} ${-80+i*75},${680-offset} ${750-i*35},1240 ${250+i*68}" fill="none" stroke="${i%3===0?'white':a}" stroke-width="${15+i*6}" opacity="${.25+i*.11}"/>`);
 if(g===5)return repeat(9,i=>`<path d="M0 ${225+i*51}Q${x} ${100+i*49} 1200 ${215+i*48}V620H0Z" fill="${i%3===0?'white':a}" opacity="${.07+i*.045}"/>`);
 if(g===6)return repeat(7,i=>`<path d="M${i*210-180} 600L${i*170+offset} ${155+(i%3)*50}L${i*235+230} 600Z" fill="${i%2?'white':a}" opacity="${.1+(i%4)*.12}"/>`);
 if(g===7)return repeat(9,i=>`<ellipse cx="${x+250}" cy="${y+120}" rx="270" ry="73" transform="rotate(${i*40+n*9} ${x+250} ${y+120})" fill="none" stroke="${i%3===0?'white':a}" stroke-width="${i%3===0?5:13}" opacity=".7"/>`);
 if(g===8)return repeat(12,i=>`<path d="M-50 ${180+i*44}C${200+offset} ${640-i*21},${720-offset} ${-70+i*42},1250 ${255+i*47}" fill="none" stroke="${i%4===0?'white':a}" stroke-width="${i%4===0?7:2}" opacity=".75"/>`);
 return repeat(8,i=>repeat(4,j=>`<path d="M${i*155} ${145+j*120}h150v115h-150Z" fill="${(i+j+n)%3===0?'white':a}" opacity="${.08+((i*3+j+n)%7)*.07}"/><path d="M${i*155} ${145+j*120}h150l-150 115Z" fill="white" opacity="${.04+((i+j+n)%3)*.05}"/>`));
}
for(const [g,line] of groups.entries())for(const [n,item] of line.split('|').slice(1).entries()){
 const id=item.split(':')[0].toLowerCase().replace(/[^a-z0-9]+/g,'-');
 const title=`${styles[g]} ${String(n+1).padStart(2,'0')}`;
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 600" role="img"><title>${title}</title><rect width="1200" height="600" fill="${palette[g]}"/>${artwork(g,n)}</svg>`;
 fs.writeFileSync(new URL(id+'.svg',out),svg);catalog.push({id,title,category:styles[g]});
}
if(catalog.length!==100)throw Error('Expected 100 covers');
writeCatalogue();
console.log(`Generated ${catalog.length} background-only company covers. Titles and logos are interface overlays.`);
