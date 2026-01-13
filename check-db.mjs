import admin from 'firebase-admin';

admin.initializeApp({
  projectId: 'soccer-analyzer-483917'
});

const db = admin.firestore();

console.log('=== CHECKING MATCHES ===\n');

const matchesSnapshot = await db.collection('matches').limit(5).get();
console.log('Total matches found:', matchesSnapshot.size, '\n');

matchesSnapshot.forEach(doc => {
  const data = doc.data();
  console.log('Match ID:', doc.id);
  console.log('  Video path:', data.video?.storagePath || 'N/A');
  console.log('  Analysis status:', data.analysis?.status || 'N/A');
  console.log('  Analysis activeVersion:', data.analysis?.activeVersion || 'N/A');
  console.log('  Analysis needsRecalculation:', data.analysis?.needsRecalculation || false);
  console.log('  Analysis lastRunAt:', data.analysis?.lastRunAt || 'N/A');
  console.log('  Analysis errorMessage:', data.analysis?.errorMessage || 'N/A');
  console.log('');
});

console.log('\n=== CHECKING JOBS ===\n');

const jobsSnapshot = await db.collection('jobs')
  .orderBy('createdAt', 'desc')
  .limit(10)
  .get();

console.log('Total jobs found:', jobsSnapshot.size, '\n');

jobsSnapshot.forEach(doc => {
  const data = doc.data();
  console.log('Job ID:', doc.id);
  console.log('  Match ID:', data.matchId);
  console.log('  Type:', data.type);
  console.log('  Status:', data.status);
  console.log('  Step:', data.step);
  console.log('  Progress:', data.progress);
  console.log('  Error:', data.error || 'N/A');
  console.log('  Created:', data.createdAt);
  console.log('  Updated:', data.updatedAt);
  console.log('');
});

process.exit(0);
