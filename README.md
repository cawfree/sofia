<p align="center">
  <img src="./raw/sofia.png" alt="sofia" width="250" height="250">
</p>

# sofia
Firestore Rules. With variables.

## 🤔  What is sofia?
sofia is a representation of Firestore Rules described using JSON, which provides several benefits over the `.rules` syntax:

  - Provides variable declarations to reduce verbosity
  - Promotes more rigid and predictable rules structure
  - Better linter compatibility
  - Easily integrated with dynamic representations
  - Relative path resolution
  - Generates clean structured code

## 🚀 Installing
Using `npm`:
```
npm install --save @cawfree/sofia
```

Using `yarn`:
```
yarn add @cawfree/sofia
```

## ✍️ Syntax Example

In the example below, we provide an example of dynamically constructing a `sofia`-compatible JSON object.

```javascript
// Checks whether the referenced document is not deleted.
const ensureNotDeleted = doc => `!${doc}.deleted`;
// Ensures that a document's user information can never change.
const ensureUserNotChanged = (next, last) => `${next}.userId == userId && ${next}.userId == ${last}.userId`;
const rules = sofia(
  // Use the default service; this could be a string like 'firebase.storage', if you wanted to write storage rules.
  undefined,
  {
    // Define $variables that are scoped to the adjacent collections and their subcollections.
    // Note that variables are subject to by subcollections.
    $variable: {
      nextDoc: 'request.resource.data',
      lastDoc: 'resource.data',
      userId: 'request.auth.uid',
      offset: 'request.query.offset',
    },
    ['databases/{database}']: {
      // Define the reference of the existing collection. This object effectively
      // describes the database root as 'databases/{database}/documents'.
      $ref: 'documents',
      atomic: {
        $ref: 'docId',
        // Here we define the list rule, where we state callers are permitted
        // to make list queries if they have provided a falsey offset. 
        // Looking at the global variables, offset refers to "request.query.offset".
        $list: 'offset == null || offset == 0',
        // Here we can execute additional conditions based upon the results of the 
        // function invocations.
        $update: [
          ensureNotDeleted('nextDoc'),
          ensureUserNotChanged('nextDoc', 'lastDoc'),
        ]
          .join(' && '),
      },
    },
  },
);
```
After a call to `sofia`, the returned JSON is as follows:
```
service cloud.firestore {
  $match /databases/{database}/documents {
    $match /atomic/docId {
      allow list: request.query.offset == null || request.query.offset == 0;
      allow update: !request.resource.data.deleted && request.resource.data.userId == request.auth.uid && request.resource.data.userId == resource.data.userId;
    }
  }
}
```

For further information, check out `index.test.js` to find a complete breakdown of the sofia syntax.

## ✌️ Credits
Made possible by [expression-eval](https://www.npmjs.com/package/expression-eval).
