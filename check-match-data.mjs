import admin from 'firebase-admin';

admin.initializeApp({
  projectId: 'soccer-analyzer-483917'
});

const db = admin.firestore();
const matchId = '01JHDXKD66DWAQZ0KKZS32WHW5';

console.log('=== Match Document ===');
const matchDoc = await db.collection('matches').doc(matchId).get();
if (!matchDoc.exists) {
  console.log('Match not found!');
  process.exit(1);
}

const matchData = matchDoc.data();
console.log('Match exists');
console.log('Analysis:', JSON.stringify(matchData.analysis, null, 2));

console.log('\n=== Checking Stats (both v1 and v2 locations) ===');

// Check stats subcollection
const statsV1 = await db.collection('matches').doc(matchId).collection('stats').get();
console.log('Stats (v1 subcollection):', statsV1.size);

// Check stats in match document itself (if exists)
if (matchData.stats) {
  console.log('Stats in match document:', Object.keys(matchData.stats).length);
  console.log('Stats keys:', Object.keys(matchData.stats));
}

// Check statsV2
if (matchData.statsV2) {
  console.log('StatsV2 exists:', typeof matchData.statsV2);
  console.log('StatsV2 keys:', Object.keys(matchData.statsV2));
}

console.log('\n=== All Collections ===');
const allCollections = await db.collection('matches').doc(matchId).listCollections();
console.log('Subcollections:');
allCollections.forEach(col => console.log('  -', col.id));

process.exit(0);
