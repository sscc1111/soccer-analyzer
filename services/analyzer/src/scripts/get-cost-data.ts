import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin
if (getApps().length === 0) {
  initializeApp({
    projectId: 'soccer-analyzer-483917',
  });
}

const db = getFirestore();

async function getLatestCostData() {
  // Get recent matches
  const matchesSnap = await db.collection('matches')
    .orderBy('createdAt', 'desc')
    .limit(5)
    .get();

  console.log(`Found ${matchesSnap.size} recent matches\n`);

  for (const matchDoc of matchesSnap.docs) {
    const matchId = matchDoc.id;
    const matchData = matchDoc.data();
    console.log(`\n=== Match: ${matchId} ===`);
    const createdAt = matchData.createdAt;
    if (createdAt && createdAt.toDate) {
      console.log(`Created: ${createdAt.toDate()}`);
    } else {
      console.log(`Created: ${createdAt}`);
    }
    console.log(`Status: ${matchData.status}`);

    // Get cost summary
    const summarySnap = await db
      .collection('matches')
      .doc(matchId)
      .collection('costTracking')
      .doc('summary')
      .get();

    if (summarySnap.exists) {
      const summary = summarySnap.data();
      if (summary) {
        console.log('\n--- Cost Summary ---');
        console.log(`Total Cost: $${(summary.totalCost || 0).toFixed(4)}`);
        console.log(`Input Tokens: ${(summary.totalInputTokens || 0).toLocaleString()}`);
        console.log(`Output Tokens: ${(summary.totalOutputTokens || 0).toLocaleString()}`);
        console.log(`Cached Tokens: ${(summary.totalCachedTokens || 0).toLocaleString()}`);
        console.log(`Requests: ${summary.requestCount || 0}`);
        console.log(`Savings: $${(summary.savings || 0).toFixed(4)} (${(summary.savingsPercent || 0).toFixed(1)}%)`);
      }
    } else {
      console.log('No cost tracking data found');
    }

    // Get cost breakdown by step
    const recordsSnap = await db
      .collection('matches')
      .doc(matchId)
      .collection('costRecords')
      .get();

    if (!recordsSnap.empty) {
      console.log('\n--- Cost by Step ---');
      const byStep = new Map<string, { cost: number; count: number; input: number; output: number }>();

      recordsSnap.docs.forEach(doc => {
        const data = doc.data();
        const step = data.step || 'unknown';
        const existing = byStep.get(step) || { cost: 0, count: 0, input: 0, output: 0 };
        existing.cost += data.totalCost || 0;
        existing.count += 1;
        existing.input += data.inputTokens || 0;
        existing.output += data.outputTokens || 0;
        byStep.set(step, existing);
      });

      Array.from(byStep.entries())
        .sort((a, b) => b[1].cost - a[1].cost)
        .forEach(([step, data]) => {
          console.log(`  ${step}: $${data.cost.toFixed(4)} (${data.count} calls, ${data.input.toLocaleString()} in, ${data.output.toLocaleString()} out)`);
        });
    }
  }
}

getLatestCostData().catch(console.error);
