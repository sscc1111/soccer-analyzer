import admin from 'firebase-admin';

admin.initializeApp({
  projectId: 'soccer-analyzer-483917'
});

const db = admin.firestore();

console.log('=== CHECKING MATCH DATES ===\n');

const matchesSnapshot = await db.collection('matches')
  .orderBy('createdAt', 'desc')
  .limit(10)
  .get();

console.log('Total matches found:', matchesSnapshot.size, '\n');

matchesSnapshot.forEach(doc => {
  const data = doc.data();
  console.log('Match ID:', doc.id);
  console.log('  Title:', data.title || 'N/A');
  console.log('  date field:', data.date || 'N/A');
  console.log('  date type:', typeof data.date);
  console.log('  createdAt:', data.createdAt);
  console.log('  createdAt type:', typeof data.createdAt, data.createdAt?.constructor?.name);
  if (data.createdAt?.toDate) {
    console.log('  createdAt.toDate():', data.createdAt.toDate().toISOString());
  }
  console.log('  updatedAt:', data.updatedAt || 'N/A');
  console.log('  analysis.lastRunAt:', data.analysis?.lastRunAt || 'N/A');
  console.log('');
});

process.exit(0);
