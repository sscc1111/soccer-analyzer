import {
  initializeTestEnvironment,
  RulesTestEnvironment,
  RulesTestContext,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  setDoc,
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  addDoc,
} from 'firebase/firestore';

describe('Firestore Security Rules', () => {
  let testEnv: RulesTestEnvironment;
  const PROJECT_ID = 'soccer-analyzer-test';

  // Test users
  const USER_ALICE_ID = 'alice';
  const USER_BOB_ID = 'bob';
  const MATCH_ID = 'match-123';

  beforeAll(async () => {
    // Initialize test environment with rules
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: readFileSync(resolve(__dirname, '../firebase.rules'), 'utf8'),
        host: '127.0.0.1',
        port: 8080,
      },
    });
  });

  afterAll(async () => {
    // Clean up test environment
    await testEnv.cleanup();
  });

  afterEach(async () => {
    // Clear data between tests
    await testEnv.clearFirestore();
  });

  describe('matches collection', () => {
    describe('read operations', () => {
      beforeEach(async () => {
        // Create a match owned by Alice
        await testEnv.withSecurityRulesDisabled(async (context: RulesTestContext) => {
          await setDoc(doc(context.firestore(), 'matches', MATCH_ID), {
            ownerUid: USER_ALICE_ID,
            title: 'Test Match',
            createdAt: new Date().toISOString(),
          });
        });
      });

      test('owner can read their match', async () => {
        const alice = testEnv.authenticatedContext(USER_ALICE_ID);
        const matchRef = doc(alice.firestore(), 'matches', MATCH_ID);

        await assertSucceeds(getDoc(matchRef));
      });

      test('non-owner cannot read match', async () => {
        const bob = testEnv.authenticatedContext(USER_BOB_ID);
        const matchRef = doc(bob.firestore(), 'matches', MATCH_ID);

        await assertFails(getDoc(matchRef));
      });

      test('unauthenticated user cannot read match', async () => {
        const unauthed = testEnv.unauthenticatedContext();
        const matchRef = doc(unauthed.firestore(), 'matches', MATCH_ID);

        await assertFails(getDoc(matchRef));
      });
    });

    describe('create operations', () => {
      test('authenticated user can create match with themselves as owner', async () => {
        const alice = testEnv.authenticatedContext(USER_ALICE_ID);
        const matchRef = doc(alice.firestore(), 'matches', 'new-match-1');

        await assertSucceeds(
          setDoc(matchRef, {
            ownerUid: USER_ALICE_ID,
            title: 'New Match',
            createdAt: new Date().toISOString(),
          })
        );
      });

      test('user cannot create match with different owner', async () => {
        const alice = testEnv.authenticatedContext(USER_ALICE_ID);
        const matchRef = doc(alice.firestore(), 'matches', 'new-match-2');

        await assertFails(
          setDoc(matchRef, {
            ownerUid: USER_BOB_ID, // Alice trying to set Bob as owner
            title: 'New Match',
            createdAt: new Date().toISOString(),
          })
        );
      });

      test('unauthenticated user cannot create match', async () => {
        const unauthed = testEnv.unauthenticatedContext();
        const matchRef = doc(unauthed.firestore(), 'matches', 'new-match-3');

        await assertFails(
          setDoc(matchRef, {
            ownerUid: USER_ALICE_ID,
            title: 'New Match',
            createdAt: new Date().toISOString(),
          })
        );
      });
    });

    describe('update operations', () => {
      beforeEach(async () => {
        // Create a match owned by Alice
        await testEnv.withSecurityRulesDisabled(async (context: RulesTestContext) => {
          await setDoc(doc(context.firestore(), 'matches', MATCH_ID), {
            ownerUid: USER_ALICE_ID,
            title: 'Test Match',
            status: 'pending',
            createdAt: new Date().toISOString(),
          });
        });
      });

      test('owner can update their match', async () => {
        const alice = testEnv.authenticatedContext(USER_ALICE_ID);
        const matchRef = doc(alice.firestore(), 'matches', MATCH_ID);

        await assertSucceeds(
          updateDoc(matchRef, {
            status: 'processing',
          })
        );
      });

      test('non-owner cannot update match', async () => {
        const bob = testEnv.authenticatedContext(USER_BOB_ID);
        const matchRef = doc(bob.firestore(), 'matches', MATCH_ID);

        await assertFails(
          updateDoc(matchRef, {
            status: 'processing',
          })
        );
      });

      test('unauthenticated user cannot update match', async () => {
        const unauthed = testEnv.unauthenticatedContext();
        const matchRef = doc(unauthed.firestore(), 'matches', MATCH_ID);

        await assertFails(
          updateDoc(matchRef, {
            status: 'processing',
          })
        );
      });
    });

    describe('delete operations', () => {
      beforeEach(async () => {
        // Create a match owned by Alice
        await testEnv.withSecurityRulesDisabled(async (context: RulesTestContext) => {
          await setDoc(doc(context.firestore(), 'matches', MATCH_ID), {
            ownerUid: USER_ALICE_ID,
            title: 'Test Match',
            createdAt: new Date().toISOString(),
          });
        });
      });

      test('owner can delete their match', async () => {
        const alice = testEnv.authenticatedContext(USER_ALICE_ID);
        const matchRef = doc(alice.firestore(), 'matches', MATCH_ID);

        await assertSucceeds(deleteDoc(matchRef));
      });

      test('non-owner cannot delete match', async () => {
        const bob = testEnv.authenticatedContext(USER_BOB_ID);
        const matchRef = doc(bob.firestore(), 'matches', MATCH_ID);

        await assertFails(deleteDoc(matchRef));
      });

      test('unauthenticated user cannot delete match', async () => {
        const unauthed = testEnv.unauthenticatedContext();
        const matchRef = doc(unauthed.firestore(), 'matches', MATCH_ID);

        await assertFails(deleteDoc(matchRef));
      });
    });
  });

  describe('matches subcollections', () => {
    beforeEach(async () => {
      // Create a match owned by Alice
      await testEnv.withSecurityRulesDisabled(async (context: RulesTestContext) => {
        await setDoc(doc(context.firestore(), 'matches', MATCH_ID), {
          ownerUid: USER_ALICE_ID,
          title: 'Test Match',
          createdAt: new Date().toISOString(),
        });
      });
    });

    describe('tracks subcollection', () => {
      const TRACK_ID = 'track-1';

      test('owner can read tracks', async () => {
        // Setup: create a track
        await testEnv.withSecurityRulesDisabled(async (context: RulesTestContext) => {
          await setDoc(
            doc(context.firestore(), 'matches', MATCH_ID, 'tracks', TRACK_ID),
            {
              frameNumber: 100,
              positions: [],
              timestamp: new Date().toISOString(),
            }
          );
        });

        const alice = testEnv.authenticatedContext(USER_ALICE_ID);
        const trackRef = doc(
          alice.firestore(),
          'matches',
          MATCH_ID,
          'tracks',
          TRACK_ID
        );

        await assertSucceeds(getDoc(trackRef));
      });

      test('owner can write tracks', async () => {
        const alice = testEnv.authenticatedContext(USER_ALICE_ID);
        const trackRef = doc(
          alice.firestore(),
          'matches',
          MATCH_ID,
          'tracks',
          'new-track'
        );

        await assertSucceeds(
          setDoc(trackRef, {
            frameNumber: 200,
            positions: [],
            timestamp: new Date().toISOString(),
          })
        );
      });

      test('non-owner cannot read tracks', async () => {
        // Setup: create a track
        await testEnv.withSecurityRulesDisabled(async (context: RulesTestContext) => {
          await setDoc(
            doc(context.firestore(), 'matches', MATCH_ID, 'tracks', TRACK_ID),
            {
              frameNumber: 100,
              positions: [],
              timestamp: new Date().toISOString(),
            }
          );
        });

        const bob = testEnv.authenticatedContext(USER_BOB_ID);
        const trackRef = doc(
          bob.firestore(),
          'matches',
          MATCH_ID,
          'tracks',
          TRACK_ID
        );

        await assertFails(getDoc(trackRef));
      });

      test('non-owner cannot write tracks', async () => {
        const bob = testEnv.authenticatedContext(USER_BOB_ID);
        const trackRef = doc(
          bob.firestore(),
          'matches',
          MATCH_ID,
          'tracks',
          'new-track'
        );

        await assertFails(
          setDoc(trackRef, {
            frameNumber: 200,
            positions: [],
            timestamp: new Date().toISOString(),
          })
        );
      });
    });

    describe('passEvents subcollection', () => {
      const EVENT_ID = 'event-1';

      test('owner can read passEvents', async () => {
        // Setup: create an event
        await testEnv.withSecurityRulesDisabled(async (context: RulesTestContext) => {
          await setDoc(
            doc(
              context.firestore(),
              'matches',
              MATCH_ID,
              'passEvents',
              EVENT_ID
            ),
            {
              type: 'pass',
              timestamp: 10.5,
              success: true,
            }
          );
        });

        const alice = testEnv.authenticatedContext(USER_ALICE_ID);
        const eventRef = doc(
          alice.firestore(),
          'matches',
          MATCH_ID,
          'passEvents',
          EVENT_ID
        );

        await assertSucceeds(getDoc(eventRef));
      });

      test('owner can write passEvents', async () => {
        const alice = testEnv.authenticatedContext(USER_ALICE_ID);
        const eventRef = doc(
          alice.firestore(),
          'matches',
          MATCH_ID,
          'passEvents',
          'new-event'
        );

        await assertSucceeds(
          setDoc(eventRef, {
            type: 'pass',
            timestamp: 20.5,
            success: false,
          })
        );
      });

      test('non-owner cannot access passEvents', async () => {
        // Setup: create an event
        await testEnv.withSecurityRulesDisabled(async (context: RulesTestContext) => {
          await setDoc(
            doc(
              context.firestore(),
              'matches',
              MATCH_ID,
              'passEvents',
              EVENT_ID
            ),
            {
              type: 'pass',
              timestamp: 10.5,
              success: true,
            }
          );
        });

        const bob = testEnv.authenticatedContext(USER_BOB_ID);
        const eventRef = doc(
          bob.firestore(),
          'matches',
          MATCH_ID,
          'passEvents',
          EVENT_ID
        );

        await assertFails(getDoc(eventRef));
      });
    });

    describe('pendingReviews subcollection', () => {
      const REVIEW_ID = 'review-1';

      test('owner can read pendingReviews', async () => {
        // Setup: create a pending review
        await testEnv.withSecurityRulesDisabled(async (context: RulesTestContext) => {
          await setDoc(
            doc(
              context.firestore(),
              'matches',
              MATCH_ID,
              'pendingReviews',
              REVIEW_ID
            ),
            {
              eventType: 'pass',
              timestamp: 15.0,
              confidence: 0.75,
            }
          );
        });

        const alice = testEnv.authenticatedContext(USER_ALICE_ID);
        const reviewRef = doc(
          alice.firestore(),
          'matches',
          MATCH_ID,
          'pendingReviews',
          REVIEW_ID
        );

        await assertSucceeds(getDoc(reviewRef));
      });

      test('owner can write pendingReviews', async () => {
        const alice = testEnv.authenticatedContext(USER_ALICE_ID);
        const reviewRef = doc(
          alice.firestore(),
          'matches',
          MATCH_ID,
          'pendingReviews',
          'new-review'
        );

        await assertSucceeds(
          setDoc(reviewRef, {
            eventType: 'pass',
            timestamp: 25.0,
            confidence: 0.8,
          })
        );
      });

      test('non-owner cannot access pendingReviews', async () => {
        const bob = testEnv.authenticatedContext(USER_BOB_ID);
        const reviewRef = doc(
          bob.firestore(),
          'matches',
          MATCH_ID,
          'pendingReviews',
          REVIEW_ID
        );

        await assertFails(getDoc(reviewRef));
      });
    });

    describe('stats subcollection', () => {
      const STAT_ID = 'stat-1';

      test('owner can read stats', async () => {
        // Setup: create a stat
        await testEnv.withSecurityRulesDisabled(async (context: RulesTestContext) => {
          await setDoc(
            doc(context.firestore(), 'matches', MATCH_ID, 'stats', STAT_ID),
            {
              metricKey: 'passes_completed',
              value: 42,
              timestamp: new Date().toISOString(),
            }
          );
        });

        const alice = testEnv.authenticatedContext(USER_ALICE_ID);
        const statRef = doc(
          alice.firestore(),
          'matches',
          MATCH_ID,
          'stats',
          STAT_ID
        );

        await assertSucceeds(getDoc(statRef));
      });

      test('owner can write stats', async () => {
        const alice = testEnv.authenticatedContext(USER_ALICE_ID);
        const statRef = doc(
          alice.firestore(),
          'matches',
          MATCH_ID,
          'stats',
          'new-stat'
        );

        await assertSucceeds(
          setDoc(statRef, {
            metricKey: 'passes_attempted',
            value: 50,
            timestamp: new Date().toISOString(),
          })
        );
      });

      test('non-owner cannot access stats', async () => {
        const bob = testEnv.authenticatedContext(USER_BOB_ID);
        const statRef = doc(
          bob.firestore(),
          'matches',
          MATCH_ID,
          'stats',
          STAT_ID
        );

        await assertFails(getDoc(statRef));
      });
    });
  });

  describe('jobs collection', () => {
    const JOB_ID = 'job-123';

    test('authenticated user can read jobs', async () => {
      // Setup: create a job
      await testEnv.withSecurityRulesDisabled(async (context: RulesTestContext) => {
        await setDoc(doc(context.firestore(), 'jobs', JOB_ID), {
          matchId: MATCH_ID,
          status: 'running',
          createdAt: new Date().toISOString(),
        });
      });

      const alice = testEnv.authenticatedContext(USER_ALICE_ID);
      const jobRef = doc(alice.firestore(), 'jobs', JOB_ID);

      await assertSucceeds(getDoc(jobRef));
    });

    test('unauthenticated user cannot read jobs', async () => {
      // Setup: create a job
      await testEnv.withSecurityRulesDisabled(async (context: RulesTestContext) => {
        await setDoc(doc(context.firestore(), 'jobs', JOB_ID), {
          matchId: MATCH_ID,
          status: 'running',
          createdAt: new Date().toISOString(),
        });
      });

      const unauthed = testEnv.unauthenticatedContext();
      const jobRef = doc(unauthed.firestore(), 'jobs', JOB_ID);

      await assertFails(getDoc(jobRef));
    });

    test('authenticated user cannot create jobs', async () => {
      const alice = testEnv.authenticatedContext(USER_ALICE_ID);
      const jobRef = doc(alice.firestore(), 'jobs', 'new-job');

      await assertFails(
        setDoc(jobRef, {
          matchId: MATCH_ID,
          status: 'pending',
          createdAt: new Date().toISOString(),
        })
      );
    });

    test('authenticated user cannot update jobs', async () => {
      // Setup: create a job
      await testEnv.withSecurityRulesDisabled(async (context: RulesTestContext) => {
        await setDoc(doc(context.firestore(), 'jobs', JOB_ID), {
          matchId: MATCH_ID,
          status: 'running',
          createdAt: new Date().toISOString(),
        });
      });

      const alice = testEnv.authenticatedContext(USER_ALICE_ID);
      const jobRef = doc(alice.firestore(), 'jobs', JOB_ID);

      await assertFails(
        updateDoc(jobRef, {
          status: 'completed',
        })
      );
    });

    test('authenticated user cannot delete jobs', async () => {
      // Setup: create a job
      await testEnv.withSecurityRulesDisabled(async (context: RulesTestContext) => {
        await setDoc(doc(context.firestore(), 'jobs', JOB_ID), {
          matchId: MATCH_ID,
          status: 'running',
          createdAt: new Date().toISOString(),
        });
      });

      const alice = testEnv.authenticatedContext(USER_ALICE_ID);
      const jobRef = doc(alice.firestore(), 'jobs', JOB_ID);

      await assertFails(deleteDoc(jobRef));
    });
  });

  describe('users collection', () => {
    const USER_ID = 'user-123';

    test('user can read their own user document', async () => {
      // Setup: create a user document
      await testEnv.withSecurityRulesDisabled(async (context: RulesTestContext) => {
        await setDoc(doc(context.firestore(), 'users', USER_ID), {
          name: 'Test User',
          email: 'test@example.com',
          createdAt: new Date().toISOString(),
        });
      });

      const user = testEnv.authenticatedContext(USER_ID);
      const userRef = doc(user.firestore(), 'users', USER_ID);

      await assertSucceeds(getDoc(userRef));
    });

    test('user can write their own user document', async () => {
      const user = testEnv.authenticatedContext(USER_ID);
      const userRef = doc(user.firestore(), 'users', USER_ID);

      await assertSucceeds(
        setDoc(userRef, {
          name: 'New User',
          email: 'newuser@example.com',
          createdAt: new Date().toISOString(),
        })
      );
    });

    test('user cannot read other user documents', async () => {
      // Setup: create a user document
      await testEnv.withSecurityRulesDisabled(async (context: RulesTestContext) => {
        await setDoc(doc(context.firestore(), 'users', USER_BOB_ID), {
          name: 'Bob',
          email: 'bob@example.com',
          createdAt: new Date().toISOString(),
        });
      });

      const alice = testEnv.authenticatedContext(USER_ALICE_ID);
      const bobRef = doc(alice.firestore(), 'users', USER_BOB_ID);

      await assertFails(getDoc(bobRef));
    });

    test('user cannot write other user documents', async () => {
      const alice = testEnv.authenticatedContext(USER_ALICE_ID);
      const bobRef = doc(alice.firestore(), 'users', USER_BOB_ID);

      await assertFails(
        setDoc(bobRef, {
          name: 'Bob Modified',
          email: 'bob@example.com',
          createdAt: new Date().toISOString(),
        })
      );
    });

    describe('user subcollections', () => {
      test('user can read their own subcollections', async () => {
        // Setup: create a subcollection document
        await testEnv.withSecurityRulesDisabled(async (context: RulesTestContext) => {
          await setDoc(
            doc(context.firestore(), 'users', USER_ID, 'settings', 'prefs'),
            {
              theme: 'dark',
              language: 'en',
            }
          );
        });

        const user = testEnv.authenticatedContext(USER_ID);
        const settingsRef = doc(
          user.firestore(),
          'users',
          USER_ID,
          'settings',
          'prefs'
        );

        await assertSucceeds(getDoc(settingsRef));
      });

      test('user can write their own subcollections', async () => {
        const user = testEnv.authenticatedContext(USER_ID);
        const settingsRef = doc(
          user.firestore(),
          'users',
          USER_ID,
          'settings',
          'prefs'
        );

        await assertSucceeds(
          setDoc(settingsRef, {
            theme: 'light',
            language: 'ja',
          })
        );
      });

      test('user cannot read other user subcollections', async () => {
        // Setup: create a subcollection document
        await testEnv.withSecurityRulesDisabled(async (context: RulesTestContext) => {
          await setDoc(
            doc(
              context.firestore(),
              'users',
              USER_BOB_ID,
              'settings',
              'prefs'
            ),
            {
              theme: 'dark',
              language: 'en',
            }
          );
        });

        const alice = testEnv.authenticatedContext(USER_ALICE_ID);
        const bobSettingsRef = doc(
          alice.firestore(),
          'users',
          USER_BOB_ID,
          'settings',
          'prefs'
        );

        await assertFails(getDoc(bobSettingsRef));
      });
    });
  });
});
