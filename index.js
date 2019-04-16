 const {
  parse,
} = require('expression-eval');
const {
  resolve,
} = require('path');

const flatten = require('lodash.flatten');

const globalIdentifiers = {
  request: {},
  resource: {},
};

// TODO: should enforce that variables dont have the same
//       name as a reference
const solve = (obj, mode = '$reference', prev = '') => flatten(Object.entries(obj)
  .map(
    (entry) => {
      const [k, v] = entry;
      if (v !== null && typeof v === 'object') {
        return solve(
          v,
          k, 
        );
      }
      return {
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

function identify (def, stack, ref, pwd) {
  const {
    name,
  } = def;
  const resolved = [...stack]
    .reverse()
    .reduce(
      (obj, ctx) => {
        return (obj || search(solve(ctx), name));
      },
      null,
    );
  if (!resolved) {
    const resolvedRef = dictionary
      .reduce(
        (obj, [ k, v ]) => {
          return (k === '$ref') && v;
        },
        null,
      )
        .deref(
          def,
          stack,
          ref,
          pwd,
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
  } = resolved;
  const fn = dictionary
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
  return fn(
    def,
    stack,
    ref,
    pwd,
    path,
  );
};

const combine = (def, stack, ref, pwd) => {
  const {
    left,
    right,
    operator,
  } = def;
  return `${evaluate(left, stack, ref, pwd)} ${operator} ${evaluate(right, stack, ref, pwd)}`;
};

const syntax = {
  Literal: (def, stack, ref, pwd) => {
    const {
      raw,
      value,
    } = def;
    return `${raw || value}`;
  },
  Identifier: (def, stack, ref, pwd) => {
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
      return identify(def, stack, ref, pwd);
    }
    return name;
  },
  LogicalExpression: (def, stack, ref, pwd) => combine(def, stack, ref, pwd),
  BinaryExpression: (def, stack, ref, pwd) => combine(def, stack, ref, pwd),
  MemberExpression: (def, stack, ref, pwd) => {
    const {
      computed,
      object,
      property,
      __sofia,
    } = def;
    if (computed) {
      throw new Error(
        'Computed expressions are not supported!',
      );
    }
    // XXX: Decide whether to treat look ups as already resolved.
    //      (This can happen when a global variable is used.
    const resolved = (object.type !== 'MemberExpression');
    return `${evaluate(
      object,
      stack,
      ref,
      pwd,
    )}.${evaluate(
      // XXX: Properties should always be treated as resolved.
      { ...property, __sofia: { ...__sofia, resolved: true } },
      stack,
      ref,
      pwd,
    )}`;
  },
  UnaryExpression: (def, stack, ref, pwd) => {
    const {
      operator,
      argument,
      prefix,
    } = def;
    return `${operator}${evaluate(argument, stack, ref, pwd)}`;
  },
};

function evaluate(def, stack, ref, pwd) {
  const {
    type,
  } = def;
  if (syntax.hasOwnProperty(type)) {
    return `${syntax[type](
      def,
      stack, 
      ref,
      pwd,
    )}`;
  }
  throw new Error(
    `Encountered unexpected syntax, "${type}". Expected one of: ${(Object.keys(syntax))}.`,
  );
}

const shouldCompile = (def, stack, ref, pwd, str, mode) => {
  return `allow ${mode}: if ${evaluate(
    def,
    stack,
    ref,
    pwd,
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
const expandPath = (def, stack, ref, pwd, path) => {
  if (path.startsWith('./')) {
    return resolve(
      pwd,
      path,
    );
  }
  return path;
};

const shouldPath = (def, stack, ref, pwd, path, fn) => {
  const absolute = escapeBraces(
    expandPath(
      def,
      stack,
      ref,
      pwd,
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
          );
          return str
            .split(match)
            .join(`$(${i})`);
        } catch(e) {
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

const dictionary = Object.entries(
  {
    $variable: {
      sortOrder: 0,
    },
    $read: {
      compile: (def, stack, ref, pwd, str) => shouldCompile(def, stack, ref, pwd, str, 'read'),
    },
    $write: {
      compile: (def, stack, ref, pwd, str) => shouldCompile(def, stack, ref, pwd, str, 'write'),
    },
    $create: {
      compile: (def, stack, ref, pwd, str) => shouldCompile(def, stack, ref, pwd, str, 'create'),
    },
    $list: {
      compile: (def, stack, ref, pwd, str) => shouldCompile(def, stack, ref, pwd, str, 'list'),
    },
    $update: {
      compile: (def, stack, ref, pwd, str) => shouldCompile(def, stack, ref, pwd, str, 'update'),
    },
    $delete: {
      compile: (def, stack, ref, pwd, str) => shouldCompile(def, stack, ref, pwd, str, 'delete'),
    },
    $get: {
      identify: (def, stack, ref, pwd, path) => shouldPath(def, stack, ref, pwd, path, str => `get(${str})`),
    },
    $getAfter: {
      identify: (def, stack, ref, pwd, path) => shouldPath(def, stack, ref, pwd, path, str => `getAfter(${str})`),
    },
    $exists: {
      identify: (def, stack, ref, pwd, path) => shouldPath(def, stack, ref, pwd, path, str => `exists(${str})`),
    },
    $existsAfter: {
      identify: (def, stack, ref, pwd, path) => shouldPath(def, stack, ref, pwd, path, str => `existsAfter(${str})`),
    },
    // XXX: This is where variables propagate.
    $reference: {
      identify: (def, stack, ref, pwd, path) => {
        // XXX: Paths can reference prefined variables.
        const a = parse(path);
        const y = evaluate(
          {
            ...a,
          },
          stack,
          ref,
          pwd,
        );
        return shouldPath(def, stack, ref, pwd, y,  str => (str));
      },
    },
    // XXX: Reserved field placeholders.
    $ref: {
      deref: (def, stack, ref, pwd) => {
        const {
          name,
        } = def;
        // XXX: The user my have referred to a language-global variable.
        if (name === ref || (Object.keys(globalIdentifiers).indexOf(name) >= 0)) {
          return ref;
        }
        throw new Error(
          `Failed to resolve a variable  "${name}"!`,
        );
      },
    },
  },
)
  .sort(([, e1], [, e2]) => {
    return (e1.sortOrder || Number.MAX_VALUE) - (e2.sortOrder || Number.MAX_VALUE);
  });

const reservedKeys = dictionary
  .map(([key]) => key);

const getIndent = indent => [...Array(indent)]
  .map(() => ' ')
  .join('');

const compile = (def, stack, ref, pwd, indent, str) => {
   return dictionary
    .filter(([, { compile }]) => (!!compile))
    .filter(([mode]) => (def.hasOwnProperty(mode)))
    .reduce(
      (str, [mode, { compile }], i, arr) => {
        const statement = `${compile(
          parse(`${def[mode]}`),
          stack,
          ref,
          pwd,
          str,
        )}`;
        return `${str}\n${getIndent(indent)}${statement}`;
      },
      str,
    );
};

const deref = e => `${e || '{document=**}'}`;

function rules(def, stack = [], ref, pwd = '', indent = 2, str = '') {
  const {
    $variable,
  } = def;
  const nextStack = [
    ...stack,
    $variable,
  ]
    .filter((e) => (!!e));
  return Object.entries(
    def,
  )
    .filter(([key]) => reservedKeys.indexOf(key) < 0)
    .reduce(
      (str, [relative, entity]) => {
        const type = typeof entity;
        if (type === 'object') {
          const absolute = `${pwd}/${relative}`;
          // XXX: Ensure $refs are visible within the scope of
          //      declaration.
          const {
            $ref,
          } = entity;
          const scope = deref($ref);
          const match = `match /${relative}/${scope}`;
          const evaluated = rules(
            entity,
            nextStack,
            scope,
            `${pwd}/${relative}`,
            indent + 2,
            '',
          );
          return `${str}\n${getIndent(indent)}${match} {${evaluated}\n${getIndent(indent)}}`;
        }
        throw new Error(
          `Encountered unexpected token, "${entity}" of type ${type}.`,
        );
      },
      compile(
        def,
        nextStack,
        deref(ref),
        pwd,
        indent,
        str,
      ),
    );

}

module.exports = (a, b) => {
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
};
