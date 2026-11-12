// Usage: node bq.js file.sql [dry]  -> JSON rows (read-only; uses repo service-account key)
const path=require('path'),fs=require('fs');
const REPO=path.resolve(__dirname,'../..');
const {BigQuery}=require(path.join(REPO,'node_modules/@google-cloud/bigquery'));
const bq=new BigQuery({projectId:'sayakaya',keyFilename:path.join(REPO,'service-account.json')});
(async()=>{const dry=process.argv[3]==='dry';
const [job]=await bq.createQueryJob({query:fs.readFileSync(process.argv[2],'utf8'),location:'asia-southeast2',dryRun:dry,maximumBytesBilled:String(5e9)});
if(dry){console.log('bytes',job.metadata.statistics.totalBytesProcessed);return;}
const [rows]=await job.getQueryResults();console.log(JSON.stringify(rows));})().catch(e=>{console.error(e.message);process.exit(1)});
