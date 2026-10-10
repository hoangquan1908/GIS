import { copyFile } from 'node:fs/promises';
const assets=['index.html','style.css','app.js','app-utils.js','flood-engine.js','risk.js','favicon.svg','background.png'];
for(const asset of assets)await copyFile(new URL('../public/'+asset,import.meta.url),new URL('../'+asset,import.meta.url));
console.log('Synced '+assets.length+' static assets from public/.');
