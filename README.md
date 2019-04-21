<p align="center">
  <img src="./raw/sofia.png" alt="sofia" width="250" height="300">
</p>

# sofia
Firestore Rules. With variables.

## 🤔  What is sofia?
sofia is a representation of Firestore Rules described using JSON, which provides several benefits over the `.rules` syntax:

  - Provides variable declarations to reduce verbosity
  - Promotes more rigid and predictable rules structure
  - Easily integrated with dynamic representations
  - Relative path resolution
  - Intuitive conditions

## 🚀 Installing
Using `npm`:
```
npm install --save @cawfree/sofia
```

Using `yarn`:
```
yarn add @cawfree/sofia
```

## ✔️ Getting Started

```javascript
import sofia, { $ifel } from '@cawfree/sofia';

// declare rules json using sofia syntax
const rules = {
  $userId = 'request.auth.uid',
  'databases/{database}/documents': {
    'user/{document=**}': {
      $userIsAuthed = $userId != null,
      $exists: {
        $userIsBlocked: './../../blocked/$($userId)',
      },
      $read: '$userIsAuthed',
      $write: '$userIsAuthed && !$userIsBlocked',
    },
    'blocked/{docId}': {
      
    },
  },
};

// print the firebase-compatible rules
console.log(sofia(rules));

```

## ✍️ Syntax Examples

### Simple Variables
In the example below, we provide an example of dynamically constructing a `sofia`-compatible JSON object.

```javascript
// Checks whether the referenced document is not deleted.
const ensureNotDeleted = doc => `!${doc}.deleted`;
// Ensures that a document's user information can never change.
const ensureUserNotChanged = (next, last) => `${next}.userId == $userId && ${next}.userId == ${last}.userId`;
const rules = sofia(
  {
    // Define $variables that are scoped to the adjacent collections and their subcollections.
    // Note that variables are subject to by subcollections.
    $nextDoc: 'request.resource.data',
    $lastDoc: 'resource.data',
    $userId: 'request.auth.uid',
    $offset: 'request.query.offset',
    ['databases/{database}/documents']: {
      // Define the reference of the existing collection. This object effectively
      // describes the database root as 'databases/{database}/documents'.
      ['atomic/{docId}']: {
        // Here we define the list rule, where we state callers are permitted
        // to make list queries if they have provided a falsey offset. 
        // Looking at the global variables, offset refers to "request.query.offset".
        $list: '$offset == null || $offset == 0',
        // Here we can execute additional conditions based upon the results of the 
        // function invocations.
        $update: [
          ensureNotDeleted('$nextDoc'),
          ensureUserNotChanged('$nextDoc', '$lastDoc'),
        ]
          .join(' && '),
      },
    },
  },
);
```
After a call to `sofia`, the returned `.rules` are as follows:
```
service cloud.firestore {
  match /databases/{database}/documents {
    match /atomic/{docId} {
      allow list: if request.query.offset == null || request.query.offset == 0;
      allow update: if !request.resource.data.deleted && request.resource.data.userId == request.auth.uid && request.resource.data.userId == resource.data.userId;
    }
  }
}
```

### Transaction Variables

It is also possible to use **transaction variables**; these permit us to interact with the results of transcions  such as `exists` or `getAfter` themselves, just as if they were like any other variable. These help clearly establish the relationships that exist between collections.

```javascript
{
  ['databases/{database}/documents']: {
    $nextDoc: 'request.resource.data',
    $userId: 'request.auth.uid',
    ['outer/{document=**}']: {
      // Declare a number of $getAfter variables within the scope
      // of the 'outer' collection and its subcollections.
      $getAfter: {
        $outerVariable: './$($userId)',
      },
      $read: '$outerVariable != null',
      ['inner/{innerRefId}']: {
        // It is possible to even parse data out of the result
        // of a transaction from an adjacent cell!
        $innerVariable: '$outerVariable.userId',
        $create: '$innerVariable == $userId',
      },
    },
  },
}
```

After a call to `sofia`, the returned `.rules` are as follows:

```
service cloud.firestore {
  match /databases/{database}/documents {
    match /outer/{document=**} {
      allow read: if getAfter(/databases/$(database)/documents/outer/$(request.auth.uid)) != null;
      match /inner/{innerRefId} {
        allow create: if getAfter(/databases/$(database)/documents/outer/$(request.auth.uid)).userId == request.auth.uid;
      }
    }
  }
}
```

### Conditions

It is even possible to define **conditions**. These help clearly define which rules need to be processed based upon a previous condition. Since `.rules` are predefined, it's probably useful to note that there's nothing _special_ going on here, conditions merely resolve to a lazy evaluation of _both_ the positive and negative outcome, which effectively creates a branch in your static logic.

This block emphasises that `sofia` can result in more readable rule definitions, when handling more complex transactions.

```javascript
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
}
```

After a call to `sofia`, the returned `.rules` are as follows. As you can see, the order of the evaluated conditions are preserved, without the headaches. 

```
 service cloud.firestore {
   match /databases/{database}/documents {
     match /user/{someUserId} {
       allow read: if (((!resource.data.deleted) && ((someUserId == request.auth.uid) && true)) || ((!(someUserId == request.auth.uid)) && exists(/databases/$(database)/documents/friendsList/$(someUserId)/friend/$(request.auth.uid))));
     }
     match /friendsList/{someFriendsListId} {
       match /friend/{friendId} {
       }
     }
   }
 }
```

For further information, check out [`index.test.js`](./index.test.js) to find a complete breakdown of the sofia syntax.

## ✌️ Credits
Made possible by [jsep](https://www.npmjs.com/package/jsep).
