import admin from 'firebase-admin';

admin.initializeApp({
  projectId: 'soccer-analyzer-483917'
});

const db = admin.firestore();
const matchId = '01JHDXKD66DWAQZ0KKZS32WHW5';

console.log('=== PassEvents Detail ===');
const passEventsSnap = await db.collection('matches').doc(matchId).collection('passEvents').get();

console.log('Total passEvents:', passEventsSnap.size);

const byKicker = {};
passEventsSnap.docs.forEach(doc => {
  const data = doc.data();
  const trackId = data.kicker?.trackId;
  if (trackId) {
    if (!byKicker[trackId]) {
      byKicker[trackId] = [];
    }
    byKicker[trackId].push({
      id: doc.id,
      outcome: data.outcome,
      confidence: data.confidence
    });
  }
});

console.log('\nGrouped by kicker trackId:');
for (const [trackId, events] of Object.entries(byKicker)) {
  console.log(`  Track ${trackId}: ${events.length} passes`);
  const outcomes = events.map(e => e.outcome).join(', ');
  console.log(`    Outcomes: ${outcomes}`);
}

console.log('\n=== TrackMappings ===');
const trackMappingsSnap = await db.collection('matches').doc(matchId).collection('trackMappings').get();
console.log('Total trackMappings:', trackMappingsSnap.size);

trackMappingsSnap.docs.forEach(doc => {
  const data = doc.data();
  console.log(`  ${doc.id}: trackId=${data.trackId} -> playerId=${data.playerId}`);
});

process.exit(0);
