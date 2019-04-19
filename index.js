 const {
  parse,
} = require('expression-eval');
const {
  resolve,
  dirname,
  sep
} = require('path');

const flatten = require('lodash.flatten');

const globalIdentifiers = {
  request: {},
  resource: {},
};

// TODO: should enforce that variables dont have the same
//       name as a reference
const solve = (obj, depth, mode = '$reference', prev = '') => flatten(Object.entries(obj)
  .map(
    (entry) => {
      const [k, v] = entry;
      if (v !== null && typeof v === 'object') {
        return solve(
          v,
          depth,
          k, 
        );
      }
      return {
        depth,
        mode,
        name: k,
        path: v,
      };
    },
  ),
);

const search = (solved, name) => {
  return solved
    .reduce(
      (found, s) => {
        const {
          name: n,
        } = s;
        return found || ((name === n) && s);
      },
      null,
    );
};

function identify (def, stack, ref, pwd, depth) {
  const {
    name,
  } = def;
  const resolved = [...stack]
    .reverse()
    .reduce(
      (obj, ctx, index) => {
        // XXX: The index tracks the depth of the context
        //      within the stack.
        return (obj || search(solve(ctx, index), name));
      },
      null,
    );
  if (!resolved) {
    const resolvedRef = dictionary['$ref']
      .deref(
        def,
        stack,
        ref,
        pwd,
        depth,
      );
    if (!resolvedRef) {
      // XXX: The user may have supplied a reference.
      throw new Error(
        `Failed to resolve a variable  "${name}"!`,
      );
    }
    return resolvedRef;
  }
  const {
    mode,
    path,
    depth: resolvedDepth,
  } = resolved;
  const fn = Object.entries(dictionary)
    .filter(([, { identify }]) => (!!identify))
    .reduce(
      (fn, [key, { identify }]) => {
        return fn || ((key === mode) && identify);
      },
      null,
    );
  if (!fn) {
    // XXX: This is a development error; a reserved handler
    //      for the specified dictionary worker does not exist.
    throw new Error(
      `Development: Failed to resolve handler "${mode}"!`,
    );
  }
  // XXX: Compute the offset of the referenced variable from the current.
  const offset = depth - resolvedDepth;
  const newPath = pwd.split('/')
    // TODO: How to find the root node length? This looks like hard coding around 'depth'.
    .splice(0, offset + 4)
    .join('/');
  return fn(
    def,
    stack,
    ref,
    newPath,
    //pwd,
    depth,
    path,
  );
};

const combine = (def, stack, ref, pwd, depth) => {
  const {
    left,
    right,
    operator,
  } = def;
  return `(${evaluate(left, stack, ref, pwd, depth)} ${operator} ${evaluate(right, stack, ref, pwd, depth)})`;
};

const isCompoundBy = (obj = {}, name) => (obj.type === 'Identifier' && obj.name === name);

const syntax = {
  Literal: {
    evaluate: (def, stack, ref, pwd, depth) => {
      const {
        raw,
        value,
      } = def;
      return `${raw || value}`;
    },
  },
  Compound: {
    evaluate: (def, stack, ref, pwd, depth) => {
      return 'compound!';
    },
  },
  Identifier: {
    evaluate: (def, stack, ref, pwd, depth) => {
      const {
        name,
        __sofia,
      } = def;
      const {
        // XXX: Used to define whether to actually search for a variable or not.
        //      This prevents us from tying to look up the property of document
        //      children who are not known to the definition.
        // TODO: This may be was 'computed' is for?
        resolved,
      } = (__sofia || {});
      // XXX: Global references are resolved by default.
      // TODO: This will *NOT* be compatible outside of top-level declarations,
      //       i.e. if the user has a nested child property called 'request'.
      if (!resolved && (!globalIdentifiers[name])) {
        return identify(def, stack, ref, pwd, depth);
      }
      return name;
    },
  },
  LogicalExpression: {
    evaluate: (def, stack, ref, pwd, depth) => combine(def, stack, ref, pwd, depth),
  },
  BinaryExpression: {
    evaluate: (def, stack, ref, pwd, depth) => combine(def, stack, ref, pwd, depth),
  },
  CallExpression: {
    evaluate: (def, stack, ref, pwd, depth) => {
      const {
        arguments: args,
        callee,
      } = def;
      const x =evaluate(
        callee,
        stack,
        ref,
        pwd,
        depth,
      );
      return `${evaluate(
        callee,
        stack,
        ref,
        pwd,
        depth,
      )}(${args.map(
        (e) => evaluate(
          e,
          stack,
          ref,
          pwd,
          depth,
        ),
      ).join(', ')})`;
    },
  },
  ArrayExpression: {
    evaluate: (def, stack, ref, pwd, depth) => {
      const {
        elements,
      } = def;
      return `[${elements.map(e => evaluate(
        e,
        stack,
        ref,
        pwd,
        depth,
      )).join(', ')}]`;
    },
  },
  MemberExpression: {
    evaluate: (def, stack, ref, pwd, depth) => {
      const {
        computed,
        object,
        property,
        __sofia,
      } = def;
      const obj = evaluate(
        object,
        stack,
        ref,
        pwd,
        depth,
      );
      // XXX: Decide whether to treat look ups as already resolved.
      //      (This can happen when a global variable is used.
      return `${obj}${computed ? '[' : '.'}${evaluate(
        // XXX: Properties should always be treated as resolved.
        { ...property, __sofia: { ...__sofia, resolved: !computed } },
        stack,
        ref,
        pwd,
        depth,
      )}${computed ? ']' : ''}`;
    },
  },
  UnaryExpression: {
    evaluate: (def, stack, ref, pwd, depth) => {
      const {
        operator,
        argument,
        prefix,
      } = def;
      return `(${operator}${evaluate(argument, stack, ref, pwd, depth)})`;
    },
  },
};

function evaluate(def, stack, ref, pwd, depth) {
  const {
    type,
  } = def;
  if (syntax.hasOwnProperty(type)) {
    return `${syntax[type].evaluate(
      def,
      stack, 
      ref,
      pwd,
      depth,
    )}`;
  }
  throw new Error(
    `Encountered unexpected syntax, "${type}". Expected one of: ${(Object.keys(syntax))}.`,
  );
}

const shouldCompile = (def, stack, ref, pwd, depth, str, mode) => {
  return `allow ${mode}: if ${evaluate(
    def,
    stack,
    ref,
    pwd,
    depth,
  )};`;
};

// TODO: I don't understand what the purpose of the {} syntax
//       is when defined in a path. For now, we just replace
//       them with standard reference mechanisms, but this is likely
//       an incorrect approach.
const escapeBraces = (path) => {
  return (path.match(/\{(.*?)\}/g) || [])
    .reduce(
      (str, match) => {
        return str
          .split(match)
          .join(`$(${str.match(/\{(.*?)\}/)[1]})`);
      },
      path,
    );
};

// XXX: Turns relative path references into absolute ones.
const expandPath = (def, stack, ref, pwd, depth, path) => {
  if (path.startsWith('./')) {
    const x = resolve(
      pwd,
      path,
    );
    return x;
  }
  return path;
};

const shouldPath = (def, stack, ref, pwd, depth, path, fn) => {
  const absolute = escapeBraces(
    expandPath(
      def,
      stack,
      ref,
      pwd,
      depth,
      path,
    ),
  );
  return fn(
    (absolute.match(
      /\$\((.*?)\)/g,
    ) || [])
    // XXX: There can be duplicate matches for the same reference.
    .filter((e, i, arr) => (arr.indexOf(e) === i))
    .reduce(
      (str, match) => {
        try {
          const i = identify(
            parse(
              match
                .match(/\$\((.*?)\)/)[1],
            ),
            stack,
            ref,
            pwd,
            depth,
          );
          return str
            .split(match)
            .join(`$(${i})`);
        } catch(e) {
          // TODO: Need to catch whether the variable is defined
          //       as a $ref, as we can treat these as technically
          //       resolved.
          // TODO: Enforce this approach.
          console.warn(
            `Warning: Failed to resolve source of path "${match}.", will return unchanged. This behaviour will change in future.`,
          );
          // TODO: What to do in this case? It is unsafe
          //       to permit variables that haven't been
          //       acknowledged. Should enforce this.
          return str;
        }
      },
      absolute,
    ),
  );
};

const dictionary = {
//  $variable: {
//    //sortOrder: 0,
//  },
  $read: {
    compile: (def, stack, ref, pwd, depth, str) => shouldCompile(def, stack, ref, pwd, depth, str, 'read'),
  },
  $write: {
    compile: (def, stack, ref, pwd, depth, str) => shouldCompile(def, stack, ref, pwd, depth, str, 'write'),
  },
  $create: {
    compile: (def, stack, ref, pwd, depth, str) => shouldCompile(def, stack, ref, pwd, depth, str, 'create'),
  },
  $list: {
    compile: (def, stack, ref, pwd, depth, str) => shouldCompile(def, stack, ref, pwd, depth, str, 'list'),
  },
  $update: {
    compile: (def, stack, ref, pwd, depth, str) => shouldCompile(def, stack, ref, pwd, depth, str, 'update'),
  },
  $delete: {
    compile: (def, stack, ref, pwd, depth, str) => shouldCompile(def, stack, ref, pwd, depth, str, 'delete'),
  },
  $get: {
    identify: (def, stack, ref, pwd, depth, path) => shouldPath(def, stack, ref, pwd, depth, path, str => `get(${str})`),
  },
  $getAfter: {
    identify: (def, stack, ref, pwd, depth, path) => shouldPath(def, stack, ref, pwd, depth, path, str => `getAfter(${str})`),
  },
  $exists: {
    identify: (def, stack, ref, pwd, depth, path) => shouldPath(def, stack, ref, pwd, depth, path, str => `exists(${str})`),
  },
  $existsAfter: {
    identify: (def, stack, ref, pwd, depth, path) => shouldPath(def, stack, ref, pwd, depth, path, str => `existsAfter(${str})`),
  },
  // XXX: This is where variables propagate.
  $reference: {
    identify: (def, stack, ref, pwd, depth, path) => {
      // XXX: Paths can reference prefined variables.
      const a = parse(path);
      const y = evaluate(
        {
          ...a,
        },
        stack,
        ref,
        pwd,
        depth,
      );
      return shouldPath(def, stack, ref, pwd, depth, y,  str => (str));
    },
  },
  // XXX: Reserved field placeholders.
  $ref: {
    deref: (def, stack, ref, pwd, depth) => {
      const {
        name,
      } = def;
      // XXX: The user my have referred to a language-global variable.
      if (name === ref || (Object.keys(globalIdentifiers).indexOf(name) >= 0)) {
        return ref;
      } else if (pwd.includes(`{${name}}`)) {
        // XXX: This indicates the variable was defined as a reference within
        //      the collection path.
        return name;
      }
      throw new Error(
        `Failed to resolve a variable  "${name}"!`,
      );
    },
  },
};
//  },
//)
//  .sort(([, e1], [, e2]) => {
//    return (e1.sortOrder || Number.MAX_VALUE) - (e2.sortOrder || Number.MAX_VALUE);
//  });

const reservedKeys = Object.entries(dictionary)
  .map(([key]) => key);

const getIndent = depth => [...Array((depth + 1) * 2)]
  .map(() => ' ')
  .join('');

const compile = (def, stack, ref, pwd, depth, str) => {
   return Object.entries(dictionary)
    .filter(([, { compile }]) => (!!compile))
    .filter(([mode]) => (def.hasOwnProperty(mode)))
    .reduce(
      (str, [mode, { compile }], i, arr) => {
        const statement = `${compile(
          parse(`${def[mode]}`),
          stack,
          ref,
          pwd,
          depth,
          str,
        )}`;
        return `${str}\n${getIndent(depth)}${statement}`;
      },
      str,
    );
};

const deref = e => `${e || '{document=**}'}`;

const getVariables = (def) => {
  return Object.entries(def)
    .reduce(
      (obj, [key, value]) => {
        const reserved = reservedKeys
          .indexOf(key) >= 0;
        const beginsWithDollar = key.charAt(0) === '$';
        if (reserved) {
          const {
            identify,
          } = dictionary[key];
          // XXX: Only items in the dictionary which provide
          //      an 'identify' function can be treated as 
          //      a variable.
          //
          // TODO: Test for presence of a function.
          if (!!identify) {
            return ({
              ...obj,
              [key]: value,
            });
          }
          return obj;
        }
        if (beginsWithDollar) {
          return ({
            ...obj,
            [key]: value,
          });
        }
        return obj;
      },
      {},
    );
};

function rules(def, stack = [], ref, pwd = '', depth = 0, str = '') {
  const $variable = getVariables(
    def,
  );
  const nextStack = [
    ...stack,
    $variable,
  ]
    .filter((e) => (!!e));
  return Object.entries(
    def,
  )
    .filter(([key]) => reservedKeys.indexOf(key) < 0)
    .filter(([key]) => {
      const isVariable = $variable.hasOwnProperty(key);
      return !isVariable;
    })
    .reduce(
      (str, [relative, entity]) => {
        const type = typeof entity;
        if (type === 'object') {
          const $ref = relative.substring(relative.lastIndexOf('/') + 1, relative.length);
          const redacted = relative.substring(0, relative.lastIndexOf($ref) - 1);
          const match = `match /${redacted}/${$ref}`;
          const $safeRef = $ref.replace(/[{}]/g,'');
          const evaluated = rules(
            entity,
            nextStack,
            // XXX: Collection variables must be removed from their reference
            //      context before they can be referred to as an in-line variable.
            // TODO: Should verify that we were supplied a valid variable, instead
            //       of escaping all braces.
            $safeRef,
            // TODO:
            `${pwd}/${redacted}/${$ref}`,
            depth + 1,
            '',
          );
          return `${str}\n${getIndent(depth)}${match} {${evaluated}\n${getIndent(depth)}}`;
        }
        throw new Error(
          `Encountered unexpected token, "${entity}" of type ${type}.`,
        );
      },
      compile(
        def,
        nextStack,
        // TODO: Used to be deref, but now $refs are required.
        ref,
        pwd+ '/$('+ref+')',
        depth,
        str,
      ),
    );
};

// XXX: Structures rules so that different rule mechanisms can be
//      defined based upon an evaluated condition. This is achieved
//      using lazy evaluation.
const $ifel = (
  condition,
  conditionMet,
  conditionNotMet,
) => {
  return `((${condition}) && ${conditionMet()}) || (!(${condition}) && ${conditionNotMet()})`;
};

module.exports = {
  default: (a, b) => {
    const ta = typeof a;
    const tb = typeof b;
    if (ta === 'string' && tb === 'object') {
      return `service ${a} {${rules(b)}\n}`;
    } else if (ta === 'object' && !b) {
      return `service cloud.firestore {${rules(a)}\n}`;
    }
    throw new Error(
      `Unexpected invocation; expected a valid rules parameter, found ${ta}.`,
    );
  },
  $ifel,
};
