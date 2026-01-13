import admin from 'firebase-admin';

admin.initializeApp({
  projectId: 'soccer-analyzer-483917'
});

const db = admin.firestore();
const matchId = 'NkUnb8v7sxljzbXO6FS5';

console.log('=== PassEvents Detail ===');
const passEventsSnap = await db.collection('matches').doc(matchId).collection('passEvents').get();
console.log('Total passEvents:', passEventsSnap.size);

const byKicker = {};
passEventsSnap.docs.forEach(doc => {
  const data = doc.data();
  const kickerData = data.kicker || {};
  const trackId = kickerData.trackId;
  
  console.log('\nPassEvent:', doc.id);
  console.log('  kicker:', JSON.stringify(kickerData));
  console.log('  trackId:', trackId, 'type:', typeof trackId);
  
  if (trackId !== undefined) {
    if (!byKicker[trackId]) {
      byKicker[trackId] = 0;
    }
    byKicker[trackId]++;
  }
});

console.log('\n=== Grouped by trackId ===');
for (const trackId in byKicker) {
  const count = byKicker[trackId];
  console.log('Track "' + trackId + '" (' + typeof trackId + '):', count, 'passes');
}

console.log('\n=== Stats for this match ===');
const statsSnap = await db.collection('matches').doc(matchId).collection('stats').get();
statsSnap.docs.forEach(doc => {
  const data = doc.data();
  if (data.calculatorId === 'passesV1') {
    console.log('PassesV1 stat:', doc.id);
    console.log('  playerId:', JSON.stringify(data.playerId));
    console.log('  metrics:', JSON.stringify(data.metrics));
    console.log('  sourceMetadata:', JSON.stringify(data.sourceMetadata));
  }
});

process.exit(0);
