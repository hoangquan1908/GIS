import { copyFile, mkdir } from 'node:fs/promises';
const assets=['index.html','style.css','app.js','app-utils.js','flood-engine.js','risk.js','favicon.svg','background.jpg'];
for(const asset of assets)await copyFile(new URL('../public/'+asset,import.meta.url),new URL('../'+asset,import.meta.url));
await mkdir(new URL('../public/data',import.meta.url),{recursive:true});
const dataFiles=['sites.geojson','gis-layers.geojson','community-reports.json','sources.json'];
for(const df of dataFiles)await copyFile(new URL('../data/'+df,import.meta.url),new URL('../public/data/'+df,import.meta.url));
console.log('Synced '+assets.length+' static assets and '+dataFiles.length+' data files.');
