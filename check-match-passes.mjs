import admin from 'firebase-admin';

admin.initializeApp({
  projectId: 'soccer-analyzer-483917'
});

const db = admin.firestore();
const matchId = '8I90aT34ItyBAypdg4Ce';

console.log('=== Match Document ===');
const matchDoc = await db.collection('matches').doc(matchId).get();
if (!matchDoc.exists) {
  console.log('Match not found!');
  process.exit(1);
}

const matchData = matchDoc.data();
console.log('Match ID:', matchId);
console.log('Analysis status:', matchData.analysis.status);
console.log('Analysis activeVersion:', matchData.analysis.activeVersion);

console.log('\n=== Subcollections ===');
const allCollections = await db.collection('matches').doc(matchId).listCollections();
console.log('Available subcollections:');
allCollections.forEach(col => console.log('  -', col.id));

console.log('\n=== Stats Collection ===');
const statsSnap = await db.collection('matches').doc(matchId).collection('stats').get();
console.log('Total stats docs:', statsSnap.size);

if (statsSnap.size > 0) {
  console.log('\nFirst 5 stats:');
  statsSnap.docs.slice(0, 5).forEach(doc => {
    const data = doc.data();
    const pid = data.playerId || 'N/A';
    console.log('  Doc:', doc.id);
    console.log('    calculatorId:', data.calculatorId);
    console.log('    scope:', data.scope);
    console.log('    playerId:', pid);
    console.log('    sourceMetadata:', JSON.stringify(data.sourceMetadata));
  });
}

console.log('\n=== PassEvents Collection ===');
const passEventsSnap = await db.collection('matches').doc(matchId).collection('passEvents').get();
console.log('Total passEvents:', passEventsSnap.size);

if (passEventsSnap.size > 0) {
  const byKicker = {};
  passEventsSnap.docs.forEach(doc => {
    const data = doc.data();
    const trackId = data.kicker ? data.kicker.trackId : null;
    if (trackId) {
      if (!byKicker[trackId]) {
        byKicker[trackId] = [];
      }
      byKicker[trackId].push({
        outcome: data.outcome
      });
    }
  });
  
  console.log('Grouped by kicker trackId:');
  for (const trackId in byKicker) {
    const events = byKicker[trackId];
    console.log('  Track', trackId, ':', events.length, 'passes');
  }
}

console.log('\n=== TrackMappings Collection ===');
const trackMappingsSnap = await db.collection('matches').doc(matchId).collection('trackMappings').get();
console.log('Total trackMappings:', trackMappingsSnap.size);

process.exit(0);
