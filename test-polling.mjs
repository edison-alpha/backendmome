/**
 * Test Polling Service
 * Tests the custom blockchain polling service
 */

import dotenv from 'dotenv';
dotenv.config();

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function testPolling() {
  console.log('========================================');
  console.log('Test Polling Service');
  console.log('========================================\n');

  try {
    // Test 1: Check polling status
    console.log('[1/6] Testing Polling Status...');
    const statusRes = await fetch(`${BASE_URL}/api/polling/status`);
    const statusData = await statusRes.json();
    
    if (statusData.success) {
      console.log('✅ Polling service is running');
      console.log(`   Last synced: ${statusData.data.last_synced_at || 'Never'}`);
      console.log(`   Last version: ${statusData.data.last_synced_version || 0}`);
      console.log(`   Is syncing: ${statusData.data.is_syncing}`);
      console.log(`   Errors: ${statusData.data.error_count || 0}`);
    } else {
      console.log('❌ Failed to get status:', statusData.error);
    }

    // Test 2: Global activity
    console.log('\n[2/6] Testing Global Activity...');
    const activityRes = await fetch(`${BASE_URL}/api/polling/activity/global?limit=5`);
    const activityData = await activityRes.json();
    
    if (activityData.success) {
      console.log(`✅ Found ${activityData.data.length} activities`);
      activityData.data.slice(0, 3).forEach(activity => {
        console.log(`   ${activity.type} | Raffle #${activity.raffleId} | ${new Date(activity.timestamp).toLocaleString()}`);
      });
    } else {
      console.log('❌ Failed to get activity:', activityData.error);
    }

    // Test 3: Global leaderboard
    console.log('\n[3/6] Testing Global Leaderboard...');
    const leaderboardRes = await fetch(`${BASE_URL}/api/polling/leaderboard/global?limit=5`);
    const leaderboardData = await leaderboardRes.json();
    
    if (leaderboardData.success) {
      console.log(`✅ Found ${leaderboardData.data.length} users`);
      leaderboardData.data.slice(0, 3).forEach(user => {
        console.log(`   #${user.rank} | ${user.address.slice(0, 10)}... | ${user.totalTickets} tickets | ${user.totalSpent.toFixed(2)} MOVE`);
      });
    } else {
      console.log('❌ Failed to get leaderboard:', leaderboardData.error);
    }

    // Test 4: Platform stats
    console.log('\n[4/6] Testing Platform Stats...');
    const statsRes = await fetch(`${BASE_URL}/api/polling/stats/platform`);
    const statsData = await statsRes.json();
    
    if (statsData.success) {
      console.log('✅ Platform stats:');
      console.log(`   Total tickets: ${statsData.data.totalTicketsSold}`);
      console.log(`   Total volume: ${statsData.data.totalVolume.toFixed(2)} MOVE`);
      console.log(`   Participants: ${statsData.data.uniqueParticipants}`);
      console.log(`   Total raffles: ${statsData.data.totalRaffles}`);
      console.log(`   Active raffles: ${statsData.data.activeRaffles}`);
    } else {
      console.log('❌ Failed to get stats:', statsData.error);
    }

    // Test 5: Compare with indexer (if available)
    console.log('\n[5/6] Comparing with Indexer...');
    try {
      const indexerRes = await fetch(`${BASE_URL}/api/activity/global?limit=5`);
      const indexerData = await indexerRes.json();
      
      if (indexerData.success && indexerData.data.length > 0) {
        console.log(`✅ Indexer has ${indexerData.data.length} activities`);
        console.log('   Both polling and indexer are working!');
      } else {
        console.log('⚠️  Indexer has no data (expected if indexer is down)');
        console.log('   Polling service is the fallback!');
      }
    } catch (error) {
      console.log('⚠️  Indexer unavailable:', error.message);
    }

    // Test 6: Test specific raffle (if exists)
    console.log('\n[6/6] Testing Raffle-Specific Data...');
    if (activityData.success && activityData.data.length > 0) {
      const raffleId = activityData.data[0].raffleId;
      
      const raffleActivityRes = await fetch(`${BASE_URL}/api/polling/activity/raffle/${raffleId}?limit=5`);
      const raffleActivityData = await raffleActivityRes.json();
      
      if (raffleActivityData.success) {
        console.log(`✅ Raffle #${raffleId} has ${raffleActivityData.data.length} activities`);
      }

      const raffleStatsRes = await fetch(`${BASE_URL}/api/polling/stats/raffle/${raffleId}`);
      const raffleStatsData = await raffleStatsRes.json();
      
      if (raffleStatsData.success) {
        console.log(`   Tickets: ${raffleStatsData.data.totalTicketsSold}`);
        console.log(`   Volume: ${raffleStatsData.data.totalVolume.toFixed(2)} MOVE`);
        console.log(`   Participants: ${raffleStatsData.data.uniqueParticipants}`);
      }
    } else {
      console.log('⚠️  No raffles found to test');
    }

    console.log('\n========================================');
    console.log('Test Complete');
    console.log('========================================');
    console.log(`Base URL: ${BASE_URL}`);
    console.log(`Contract: ${process.env.RAFFLE_CONTRACT_ADDRESS}`);

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
  }
}

testPolling();
