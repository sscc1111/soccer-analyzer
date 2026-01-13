import admin from 'firebase-admin';

admin.initializeApp({
  projectId: 'soccer-analyzer-483917'
});

const db = admin.firestore();
const matchId = '01JHDXKD66DWAQZ0KKZS32WHW5';

console.log('=== Stats Collection ===');
const statsSnap = await db.collection('matches').doc(matchId).collection('stats').get();
console.log('Total stats docs:', statsSnap.size);

statsSnap.docs.forEach(doc => {
  const data = doc.data();
  console.log(`\nDoc ID: ${doc.id}`);
  console.log('  calculatorId:', data.calculatorId);
  console.log('  scope:', data.scope);
  console.log('  playerId:', data.playerId);
  console.log('  sourceMetadata:', JSON.stringify(data.sourceMetadata, null, 2));
  console.log('  metrics keys:', Object.keys(data.metrics || {}));
});

console.log('\n=== Checking all subcollections ===');
const matchRef = db.collection('matches').doc(matchId);
const collections = await matchRef.listCollections();
console.log('Available subcollections:');
collections.forEach(col => console.log('  -', col.id));

process.exit(0);
