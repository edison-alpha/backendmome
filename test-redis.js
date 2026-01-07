// Test Redis Connection
import { createClient } from 'redis';

const client = createClient({
  username: 'default',
  password: 'maTOug4o11wlPOIaZ9Vx3M92NUeqKVEU',
  socket: {
    host: 'redis-13780.c8.us-east-1-3.ec2.cloud.redislabs.com',
    port: 13780
  }
});

client.on('error', (err) => {
  console.error('❌ Redis Client Error:', err);
  process.exit(1);
});

client.on('connect', () => {
  console.log('🔄 Connecting to Redis...');
});

client.on('ready', () => {
  console.log('✅ Redis connected and ready!');
});

async function testRedis() {
  try {
    console.log('🚀 Starting Redis connection test...\n');
    
    // Connect
    await client.connect();
    
    // Test 1: PING
    console.log('Test 1: PING');
    const pong = await client.ping();
    console.log(`  Result: ${pong} ✅\n`);
    
    // Test 2: SET
    console.log('Test 2: SET key');
    await client.set('test:key', 'Hello Redis!');
    console.log('  Result: Key set ✅\n');
    
    // Test 3: GET
    console.log('Test 3: GET key');
    const value = await client.get('test:key');
    console.log(`  Result: ${value} ✅\n`);
    
    // Test 4: SET with expiry
    console.log('Test 4: SET with TTL (10 seconds)');
    await client.setEx('test:ttl', 10, 'Expires in 10s');
    const ttl = await client.ttl('test:ttl');
    console.log(`  Result: TTL = ${ttl} seconds ✅\n`);
    
    // Test 5: JSON data
    console.log('Test 5: Store JSON data');
    const jsonData = { name: 'Raffle', tickets: 100 };
    await client.set('test:json', JSON.stringify(jsonData));
    const retrieved = JSON.parse(await client.get('test:json'));
    console.log(`  Result: ${JSON.stringify(retrieved)} ✅\n`);
    
    // Cleanup
    console.log('Cleanup: Deleting test keys');
    await client.del('test:key');
    await client.del('test:json');
    console.log('  Result: Cleaned up ✅\n');
    
    console.log('🎉 All tests passed!');
    console.log('\n✅ Redis is working perfectly!');
    console.log('✅ Ready to use in backend API\n');
    
    await client.quit();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    await client.quit();
    process.exit(1);
  }
}

testRedis();
