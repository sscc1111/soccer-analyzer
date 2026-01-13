import admin from 'firebase-admin';

admin.initializeApp({
  projectId: 'soccer-analyzer-483917'
});

const db = admin.firestore();

console.log('=== Checking all matches for passEvents ===\n');

const matchesSnap = await db.collection('matches').get();
console.log('Total matches:', matchesSnap.size);

for (const matchDoc of matchesSnap.docs) {
  const matchId = matchDoc.id;
  const matchData = matchDoc.data();
  
  const passEventsSnap = await db.collection('matches').doc(matchId).collection('passEvents').get();
  const statsSnap = await db.collection('matches').doc(matchId).collection('stats').get();
  
  console.log('\nMatch:', matchId);
  console.log('  Status:', matchData.analysis ? matchData.analysis.status : 'N/A');
  console.log('  passEvents:', passEventsSnap.size);
  console.log('  stats:', statsSnap.size);
  
  if (statsSnap.size > 0) {
    const passesStats = statsSnap.docs.filter(doc => {
      const data = doc.data();
      return data.calculatorId === 'passesV1';
    });
    console.log('  passesV1 stats:', passesStats.length);
    
    if (passesStats.length > 0) {
      passesStats.forEach(doc => {
        const data = doc.data();
        console.log('    -', doc.id, 'playerId:', data.playerId || 'N/A', 'sourceMetadata:', JSON.stringify(data.sourceMetadata));
      });
    }
  }
}

process.exit(0);
