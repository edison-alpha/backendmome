import { createClient } from 'redis';

const client = createClient({
  username: 'default',
  password: 'maTOug4o11wlPOIaZ9Vx3M92NUeqKVEU',
  socket: {
    host: 'redis-13780.c8.us-east-1-3.ec2.cloud.redislabs.com',
    port: 13780
  }
});

await client.connect();

// Get all keys
const keys = await client.keys('*');
console.log('=== Redis Keys ===');
console.log('Total keys:', keys.length);
keys.forEach(k => console.log(' -', k));

// Check TTL for activity key
const activityKey = keys.find(k => k.includes('activity:global'));
if (activityKey) {
  const ttl = await client.ttl(activityKey);
  console.log('\nCache TTL for', activityKey + ':', ttl, 'seconds');
  
  const data = await client.get(activityKey);
  const parsed = JSON.parse(data);
  console.log('Cached items:', parsed.length);
}

await client.quit();
