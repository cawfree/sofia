const {
  default: sofia,
  $ifel,
} = require('./');


const print = (inst) => {
  console.log(inst);
  console.warn(JSON.stringify({ inst }));
};

test('that an invalid service cannot be created', function() {
  expect(() => sofia(0, {}))
    .toThrow();
  expect(() => sofia('firebase.storage', 'You can also use sofia to declare Firebase Storage rules.'))
    .toThrow();
  expect(() => sofia('firebase.storage', {}).toEqual('service firebase.storage {\n}'));
});

// XXX: Looks like more work than .rules, right? Just wait...
test('that a simple nested collections, references and rulesn can be defined', function() {
  const rules = sofia(
    {
      ['databases/{database}/documents']: {
        ['example/{document=**}']: {
          ['nested/{document=**}']: {
            ['collection/{collectionDocId}']: {
              $read: false,
              $list: false,
              $create: true,
              $update: true,
            },
            ['someOtherCollection/{someOtherCollectionDocId}']: {
              $read: false,
              $list: false,
              $create: true,
              $update: true,
              ['someOtherCollectionChildCollection/{document=**}']: {
                $read: false,
                $write: true,
                ['someDeeplyNestedCollection/{someDeeplyNestedDocId}']: {
                },
              },
            },
          },
        },
      },
    },
  );
  // XXX: This test evaluates to the following:
  // service cloud.firestore {
  //   match /databases/{database}/documents {
  //     match /example/{document=**} {
  //       match /nested/{document=**} {
  //         match /collection/{collectionDocId} {
  //           allow read: if false;
  //           allow create: if true;
  //           allow list: if false;
  //           allow update: if true;
  //         }
  //         match /someOtherCollection/{someOtherCollectionDocId} {
  //           allow read: if false;
  //           allow create: if true;
  //           allow list: if false;
  //           allow update: if true;
  //           match /someOtherCollectionChildCollection/{document=**} {
  //             allow read: if false;
  //             allow write: if true;
  //             match /someDeeplyNestedCollection/{someDeeplyNestedDocId} {
  //             }
  //           }
  //         }
  //       }
  //     }
  //   }
  // }
  expect(rules)
    .toEqual('service cloud.firestore {\n  match /databases/{database}/documents {\n    match /example/{document=**} {\n      match /nested/{document=**} {\n        match /collection/{collectionDocId} {\n          allow read: if false;\n          allow create: if true;\n          allow list: if false;\n          allow update: if true;\n        }\n        match /someOtherCollection/{someOtherCollectionDocId} {\n          allow read: if false;\n          allow create: if true;\n          allow list: if false;\n          allow update: if true;\n          match /someOtherCollectionChildCollection/{document=**} {\n            allow read: if false;\n            allow write: if true;\n            match /someDeeplyNestedCollection/{someDeeplyNestedDocId} {\n            }\n          }\n        }\n      }\n    }\n  }\n}');
});

// XXX: Still not convinced? I don't blame you, but stick with me...
test('that we can reference variables that support scope', function() {
  const rules = sofia(
    {
      ['databases/{database}/documents']: {
        // XXX: Global variables across the database documents.
        //      (These can be overwritten by scope.)
        $userId: 'request.auth.uid',
        ['secrets/{secretOwnerId}']: {
          // XXX: A $ref has the visibility within the collection
          //      as an identifier of the source document.
          $read: '$userId != null && $userId === secretOwnerId',
        },
      },
    },
  );
  // XXX: This test evaluates to the following:
  // service cloud.firestore {
  //   match /databases/{database}/documents {
  //     match /secrets/{secretOwnerId} {
  //       allow read: if ((request.auth.uid != null) && (request.auth.uid === secretOwnerId));
  //     }
  //   }
  // }
  expect(rules)
    .toEqual('service cloud.firestore {\n  match /databases/{database}/documents {\n    match /secrets/{secretOwnerId} {\n      allow read: if ((request.auth.uid != null) && (request.auth.uid === secretOwnerId));\n    }\n  }\n}');
});

// XXX: Okay, here, things start to get a little interesting.
//      We can define conditions around variables from
//      lots of different resources and base our conditions
//      upon these.
test('that complex expressions can be defined', function() {
  const ensureNotDeleted = doc => `!${doc}.deleted`;
  const ensureUserNotChanged = (next, last) => `${next}.userId == $userId && ${next}.userId == ${last}.userId`;
  const rules = sofia(
    {
      $nextDoc: 'request.resource.data',
      $lastDoc: 'resource.data',
      $userId: 'request.auth.uid',
      $offset: 'request.query.offset',
      ['databases/{database}/documents']: {
        ['atomic/{document=**}']: {
          $list: '$offset == null || $offset == 0',
          $update: [
            ensureNotDeleted('$nextDoc'),
            ensureUserNotChanged('$nextDoc', '$lastDoc'),
          ]
            .join(' && '),
        },
      },
    },
  );
  // XXX: This test evaluates to the following:
  // service cloud.firestore {
  //   match /databases/{database}/documents {
  //     match /atomic/{document=**} {
  //       allow list: if ((request.query.offset == null) || (request.query.offset == 0));
  //       allow update: if (((!request.resource.data.deleted) && (request.resource.data.userId == request.auth.uid)) && (request.resource.data.userId == resource.data.userId));
  //     }
  //   }
  // }
  expect(rules)
    .toEqual('service cloud.firestore {\n  match /databases/{database}/documents {\n    match /atomic/{document=**} {\n      allow list: if ((request.query.offset == null) || (request.query.offset == 0));\n      allow update: if (((!request.resource.data.deleted) && (request.resource.data.userId == request.auth.uid)) && (request.resource.data.userId == resource.data.userId));\n    }\n  }\n}');
});

// XXX: Neat, right? How about referencing collections using relative paths?
test('that sofia supports transactions and relative path definitions', function() {
  const rules = sofia(
    {
      ['databases/{database}/documents']: {
        $userId: 'request.auth.uid',
        ['report/{reportId}']: {
          $exists: {
            $flagExists: './../../../../../databases/{database}/documents/report/$(reportId)/flag/$($userId)',
          },
          $existsAfter: {
            $flagExistsAfter: './flag/$($userId)',
          },
          $create: '!$flagExists && $flagExistsAfter',
          ['flag/{flagId}']: {
          },
        },
      },
    },
  );
  // XXX: This test evaluates to the following:.
  // service cloud.firestore {
  //   match /databases/{database}/documents {
  //     match /report/{reportId} {
  //       allow create: if ((!exists(/databases/$(database)/documents/report/$(reportId)/flag/$(request.auth.uid))) && existsAfter(/databases/$(database)/documents/report/$(reportId)/flag/$(request.auth.uid)));
  //       match /flag/{flagId} {
  //       }
  //     }
  //   }
  // }
  expect(rules)
    .toEqual('service cloud.firestore {\n  match /databases/{database}/documents {\n    match /report/{reportId} {\n      allow create: if ((!exists(/databases/$(database)/documents/report/$(reportId)/flag/$(request.auth.uid))) && existsAfter(/databases/$(database)/documents/report/$(reportId)/flag/$(request.auth.uid)));\n      match /flag/{flagId} {\n      }\n    }\n  }\n}');
});

test('that variables can reference other variables in the parent scope', function() {
  const rules = sofia(
    {
      ['databases/{database}/documents']: {
        $userId: 'request.auth.uid',
        $nextDoc: 'request.resource.data',
        $userId: 'request.auth.uid',
        ['vehicle/${vehicleId}']: {
          $batchId: '$nextDoc.batchId',
          $get: {
            $batchBefore: './../../batch/$($batchId)',
          },
          $getAfter: {
            $batchAfter: './../../batch/$($batchId)',
          },
          $update: '$batchBefore == $batchId',
        },
        ['batch/{batchId}']: {
          $vehicleId: '$nextDoc.vehicleId',
          $get: {
            $vehicleBefore: './../../vehicle/$($vehicleId)',
          },
          $update: [
            '$vehicleBefore == batchId',
          ]
            .join(' || '),
        },
        ['journey/{journeyId}']: {
          $batchId: '$nextDoc.batchId',
          $get: {
            $batchBefore: './../../batch/$($batchId)',
          },
          $update: [
            '$batchBefore == journeyId',
          ]
            .join(' || '),
          ['points/{pointId}']: {
            $batchId: '$nextDoc.batchId',
            $getAfter: {
              $pointAfter: './$(pointId)',
              $vehicleAfter: './../../../vehicle/$($batchId)',
            },
            $get: {
              $batchBefore: './../../../batch/$($batchId)',
              $pointBefore: './$(pointId)',
            },
            $create: '$pointAfter != null',
            $update: '$pointBefore != null && $batchBefore != null',
          },
        },
      },
    },
  );
  // XXX: This test evaluates to the following:
  // service cloud.firestore {
  //   match /databases/{database}/documents {
  //     match /vehicle/${vehicleId} {
  //       allow update: if (get(/databases/$(database)/documents/batch/$(request.resource.data.batchId)) == request.resource.data.batchId);
  //     }
  //     match /batch/{batchId} {
  //       allow update: if (get(/databases/$(database)/documents/vehicle/$(request.resource.data.vehicleId)) == batchId);
  //     }
  //     match /journey/{journeyId} {
  //       allow update: if (get(/databases/$(database)/documents/batch/$(request.resource.data.batchId)) == journeyId);
  //       match /points/{pointId} {
  //         allow create: if (getAfter(/databases/$(database)/documents/journey/$(journeyId)/points/$(pointId)) != null);
  //         allow update: if ((get(/databases/$(database)/documents/journey/$(journeyId)/points/$(pointId)) != null) && (get(/databases/$(database)/documents/batch/$(request.resource.data.batchId)) != null));
  //       }
  //     }
  //   }
  // }
  expect(rules)
    .toEqual('service cloud.firestore {\n  match /databases/{database}/documents {\n    match /vehicle/${vehicleId} {\n      allow update: if (get(/databases/$(database)/documents/batch/$(request.resource.data.batchId)) == request.resource.data.batchId);\n    }\n    match /batch/{batchId} {\n      allow update: if (get(/databases/$(database)/documents/vehicle/$(request.resource.data.vehicleId)) == batchId);\n    }\n    match /journey/{journeyId} {\n      allow update: if (get(/databases/$(database)/documents/batch/$(request.resource.data.batchId)) == journeyId);\n      match /points/{pointId} {\n        allow create: if (getAfter(/databases/$(database)/documents/journey/$(journeyId)/points/$(pointId)) != null);\n        allow update: if ((get(/databases/$(database)/documents/journey/$(journeyId)/points/$(pointId)) != null) && (get(/databases/$(database)/documents/batch/$(request.resource.data.batchId)) != null));\n      }\n    }\n  }\n}');
});

test('that we can easily define conditions', function() {
  const rules = sofia(
    {
      $nextDoc: 'request.resource.data',
      $userId: 'request.auth.uid',
      ['databases/{database}/documents']: {
        ['user/{someUserId}']: {
          $exists: {
            $friendRecord: './../../friendsList/$(someUserId)/friend/$($userId)',
          },
          $read: '!resource.data.deleted && ' + $ifel(
            'someUserId == $userId',
            // All users are allowed to read their own documents.
            () => 'true',
            // If another user is trying to get the user information,
            // make sure they are part of their friends first.
            () => '$friendRecord',
          ),
        },
        ['friendsList/{someFriendsListId}']: {
          ['friend/{friendId}']: {

          },
        },
      },
    },
  );
  // XXX: This test evaluates to the following:
  // service cloud.firestore {
  //   match /databases/{database}/documents {
  //     match /user/{someUserId} {
  //       allow read: if (((!resource.data.deleted) && ((someUserId == request.auth.uid) && true)) || ((!(someUserId == request.auth.uid)) && exists(/databases/$(database)/documents/friendsList/$(someUserId)/friend/$(request.auth.uid))));
  //     }
  //     match /friendsList/{someFriendsListId} {
  //       match /friend/{friendId} {
  //       }
  //     }
  //   }
  // }
  expect(rules)
    .toEqual('service cloud.firestore {\n  match /databases/{database}/documents {\n    match /user/{someUserId} {\n      allow read: if (((!resource.data.deleted) && ((someUserId == request.auth.uid) && true)) || ((!(someUserId == request.auth.uid)) && exists(/databases/$(database)/documents/friendsList/$(someUserId)/friend/$(request.auth.uid))));\n    }\n    match /friendsList/{someFriendsListId} {\n      match /friend/{friendId} {\n      }\n    }\n  }\n}');
});

test('that sofia supports call expressions', function() {
  const rules = sofia(
    {
      $nextDoc: 'request.resource.data',
      $userId: 'request.auth.uid',
      ['databases/{database}/documents']: {
        ['notes/{document=**}']: {
          $write: [
            '$nextDoc.keys().hasAll([$userId, \'someOtherParameter\'], \'someOtherParam\')',
          ]
            .join(' && '),
          $list: '$nextDoc.user[$userId] == true',
          $read: '$nextDoc.title is string && ($nextDoc.rand is float || $nextDoc.rand is string)',
        },
      },
    },
  );
  // XXX: This test evaluates to the following:
  // service cloud.firestore {
  //   match /databases/{database}/documents {
  //     match /notes/{document=**} {
  //       allow read: if ((request.resource.data.title is string) && ((request.resource.data.rand is float) || (request.resource.data.rand is string)));
  //       allow write: if request.resource.data.keys().hasAll([request.auth.uid, 'someOtherParameter'], 'someOtherParam');
  //       allow list: if (request.resource.data.user[request.auth.uid] == true);
  //     }
  //   }
  // }
  expect(rules)
    .toEqual('service cloud.firestore {\n  match /databases/{database}/documents {\n    match /notes/{document=**} {\n      allow read: if ((request.resource.data.title is string) && ((request.resource.data.rand is float) || (request.resource.data.rand is string)));\n      allow write: if request.resource.data.keys().hasAll([request.auth.uid, \'someOtherParameter\'], \'someOtherParam\');\n      allow list: if (request.resource.data.user[request.auth.uid] == true);\n    }\n  }\n}');
});

test('that getter variables can reference predefined variables', function() {
  const rules = sofia(
    {
      $userId: 'request.auth.uid',
      $nextDoc: 'request.resource.data',
      'databases/{database}/documents': {
        'someCollection/{document}': {
          $get: {
            $userProfile: './../../account/$($nextDoc.username)',
            $someOtherDoc: './../../someOthers/$($nextDoc)',
          },
          $update: '$userProfile.data.someProp == $userId',
          $read: '$someOtherDoc != null',
        },
      },
    },
  );
  // XXX: This test evaluates to the following:
  // service cloud.firestore {
  //   match /databases/{database}/documents {
  //     match /someCollection/{document} {
  //       allow read: if (get(/databases/$(database)/documents/someOthers/$(request.resource.data)) != null);
  //       allow update: if (get(/databases/$(database)/documents/account/$(request.resource.data.username)).data.someProp == request.auth.uid);
  //     }
  //   }
  // }
  expect(rules)
    .toEqual('service cloud.firestore {\n  match /databases/{database}/documents {\n    match /someCollection/{document} {\n      allow read: if (get(/databases/$(database)/documents/someOthers/$(request.resource.data)) != null);\n      allow update: if (get(/databases/$(database)/documents/account/$(request.resource.data.username)).data.someProp == request.auth.uid);\n    }\n  }\n}');
});
