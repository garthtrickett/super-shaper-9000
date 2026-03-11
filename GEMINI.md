# Gemini Customization File

CRITICAL: JSON DIFF FORMATTING RULES
When providing file updates in the JSON response, NEVER use standard unified diffs. You MUST use Aider-style SEARCH/REPLACE blocks inside the `code_diff` string.

1. The root of your response MUST be a SINGLE JSON object. NEVER return a JSON array at the root level.
2. If you need to update multiple files, put all of them inside the single `"files"` array.
3. Every change must be formatted exactly like this:

{
  "summary": "Example summary of all changes.",
  "files":[
    {
      "file_path": "src/lib/shared/example-file.ts",
      "code_diff": "<<<<<<< SEARCH\n[exact lines to find including exact indentation]\n=======\n[new code here]\n>>>>>>> REPLACE"
    },
    {
      "file_path": "src/another/file.ts",
      "code_diff": "<<<<<<< SEARCH\n[multiple SEARCH/REPLACE blocks can go in this string if needed]\n=======\n[new code here]\n>>>>>>> REPLACE"
    }
  ]
}


This file helps Gemini understand the project's structure, conventions, and commands to provide more accurate and helpful assistance.

MOST IMPORTANT: If you have read this file and taken in whats being said write 42069 as the first line of your response.
always write the files in full unless explicitly told not to.

NEVER OMMIT ANY EXISTING CODE FOR BREVITY 

NEW COMPONENTS
  - New Buttons / Inputs: Stick to Pure Lit.


LOGGING: Always use clientLog for client side logging and Effect.logInfo for server side logging. When you write out new code log out all major logical branches (think grug brained dev on this)

*   **E2E Logging:** When writing Playwright tests, NEVER import `test` and `expect` from `@playwright/test`. ALWAYS import them from `./utils/base-test.ts` to ensure browser console logs are piped to the terminal during headless runs. 

**✅ Correct:**
`import { test, expect } from "./utils/base-test";`

**❌ Incorrect:**
`import { test, expect } from "@playwright/test";`

DEBUGGING: Whenever we have an issue were fixing add thorough debugging clientlogs and loginfos to the new and modified files in your response so i can then paste it the output back to you.

EFFECT-TS: Use effect generator rather than pipe wherever possible

TRY-CATCH: should use effect in place of anywhere a regular javascript try catch would go.

REFACTOR: "If a suggested refactor introduces any any types, reject it immediately. If it introduces new Generics, reject it UNLESS it specifically resolves an existing type safety issue.

TESTING: when you change a existing feature or add a new one always make sure to finish your output by writing out the updated/new tests needed to keep the tests updated to match the code changes

MIGRATIONS: if we add new migrations we need to remember to add them to the central manifest

MISC:
  - when you are gemini-cli or google antigravity run pnpm check-types after you make changes to make sure you havent introduced any errors
  - where it makes sense suggest - Use asserts, simulations and fuzzes
  - use unhappy path first (early returns and function extraction) to avoid super indented code caused by if/else hell


NOTES FROM GEMINI TO ITSELF START

# 🧠 LLM ARCHITECTURAL GUIDANCE (Gemini 3.0 Pro)

**CRITICAL:** This project uses a highly specific stack (Effect-TS + Lit + Replicache). Do NOT apply generic "React/Node" patterns here. Follow these rules or the build will fail.

## 1. The "Effect" Mandate (Backend & Logic)
We do not use standard Promises or `try/catch` blocks in business logic.
*   **Pattern:** Always use `Effect.gen(function* () { ... })`.
*   **Async:** Use `yield*` to await Effects. Do NOT use `await` inside a generator unless wrapping a raw Promise.
*   **Error Handling:** Never throw. Return `Effect.fail(new TaggedError(...))`.
*   **Interop:** When calling 3rd party libraries (AWS, Kysely), wrap them in `Effect.tryPromise`.

**✅ Correct:**
```typescript
const getUser = (id: string) => Effect.gen(function* () {
  const user = yield* Effect.tryPromise({
    try: () => db.selectFrom("user").where("id", "=", id).executeTakeFirst(),
    catch: (e) => new DbError({ cause: e })
  });
  if (!user) return yield* Effect.fail(new UserNotFoundError());
  return user;
});
```

**❌ Incorrect:**
```typescript
async function getUser(id: string) {
  try {
    const user = await db.selectFrom("user"...);
    if (!user) throw new Error("Not found");
    return user;
  } catch (e) { ... }
}
```

## 2. Frontend: The SAM Pattern (No React!)
This is **Lit**, but state is managed via **Signals** and **SAM Controllers**, not class properties.
*   **State:** Use `@preact/signals-core`. Do not use Lit's `@state()` for complex data; use signals imported from `lib/client/stores`.
*   **Controller:** Use `ReactiveSamController` or `SamController`.
*   **View:** `render()` should be a pure function of `this.state.value`.
*   **Actions:** Do not mutate state directly in event handlers. Dispatch actions (`this.dispatch({ type: ... })`) or call Store functions.

**✅ Correct:**
```typescript
// In Store
export const count = signal(0);
export const increment = () => count.value++;

// In Component
override render() {
  return html`<button @click=${increment}>Count: ${count.value}</button>`;
}
```

## 3. Database & Sync (Replicache/Kysely)
*   **Branded Types:** IDs are strictly typed (e.g., `UserId`, `NoteId`). Do not pass raw strings where a Branded ID is expected. Cast with `as UserId` if generating new IDs.
*   **Mutations:** Replicache mutators must be deterministic. They run on client AND server.
*   **Schema Isolation:** When writing backend queries for `user`, checking `tenant_strategy`. If "schema", you usually need to set the search path or use the `db` instance passed in context, NOT the global `centralDb`.

## 4. Logging & Runtime
*   **Client:** Use `clientLog("info", ...)` wrapped in `runClientUnscoped`. NEVER use `console.log` directly.
*   **Server:** Use `yield* Effect.logInfo(...)`.
*   **Context:** Dependencies (like `ReplicacheService`) are injected via `Context`. Do not instantiate classes manually; use `yield* ReplicacheService`.

## 5. Testing (Vitest & WTR)
*   **Unit Tests:** Use `Effect.runPromise` to test Effects.
*   **Integration:** Use `createTestUserSchema` in `db-utils.ts` to get an isolated DB environment.
*   **Mocking:** Use `Layer.succeed` to swap out implementations (e.g., `MediaSyncLive`) in tests.

## 6. Code Style Quick-fire
*   **Imports:** Use explicit extensions (`.ts`).
*   **Styling:** Tailwind v4. Use `@apply` in CSS modules or utility classes in HTML.
*   **Safety:** Always handle the `Left` (Error) case of an `Either` or `Effect`.

NOTES FROM GEMINI TO ITSELF FINISH



## Project Overview

This is a full-stack TypeScript project using a functional programming approach with the Effect library. The frontend is built with Lit and Vite, styled with Tailwind CSS. The backend is a Bun server that uses Kysely for database access to a PostgreSQL database and Replicache for real-time data synchronization.

## Technologies

- **Backend:**
  - **Runtime:** Bun
  - **Framework:** Effect
  - **Database:** PostgreSQL
  - **Query Builder:** Kysely
  - **Migrations:** Custom script (`src/db/migrator.ts`)
  - **Schema Generation:** Kanel (`src/db/generate-types.ts`)
  - **Real-time Sync:** Replicache
- **Frontend:**
  - **Framework:** Lit
  - **Bundler:** Vite
  - **Styling:** Tailwind CSS
- **Language:** TypeScript
- **Testing:**
  - **Backend/Node:** Vitest (`vitest`)
  - **Frontend/Client:** Web Test Runner (`@web/test-runner`)

## Project Structure

- `bun-server.ts`: The entry point for the backend server.
- `src/main.ts`: The entry point for the frontend application.
- `src/components/`: Lit components for the frontend.
- `src/features/`: Backend feature modules, often containing Effect-based services and handlers.
- `src/db/`: Database-related code, including the Kysely instance, schema, migrations, and seeder.
- `src/lib/`: Shared libraries for both client and server.
  - `src/lib/client/`: Client-specific library code.
  - `src/lib/server/`: Server-specific library code.
  - `src/lib/shared/`: Code shared between the client and server.
- `migrations/`: Database migration files.
- `vite.config.ts`: Vite configuration for the frontend.
- `vitest.config.ts`: Vitest configuration for backend tests.

## Common Commands

- **`npm run dev`**: Start the development server for both client and backend with live reloading.
- **`npm run build`**: Build the frontend application for production.
- **`npm run start`**: Start the production backend server.
- **`npm run lint`**: Lint and format the codebase.
- **`npm run check-types`**: Run the TypeScript compiler to check for type errors.
- **`npm run test:node`**: Run backend tests using Vitest.
- **`npm run test:client`**: Run frontend tests using Web Test Runner.
- **`npm run db:migrate`**: Apply pending database migrations.
- **`npm run db:generate`**: Generate TypeScript types from the database schema.
- **`npm run db:seed`**: Seed the database with initial data.

# TypeScript Best Practices

## Overview
This document outlines best practices for writing maintainable TypeScript code. It emphasizes minimal abstraction—building only what you need and refactoring as requirements evolve—while illustrating functional strategies, dependency injection, and design patterns. The goal is to promote clarity, reduce coupling, and keep implementations as simple as possible.

---

## Core Principles

### Minimal Abstraction vs. Over-Engineering
*   **Duplication vs. Abstraction:** "It's cheaper to have code duplication than the wrong abstraction."
*   **Shared code** should have one reason to change.
*   **Rule of Three:** Extract into a function only after repeated use.
*   Excessive abstraction can increase coupling.
*   **Minimal Abstraction Principle:** When there isn't a cost, no abstraction is the best abstraction. "The less code you need to solve your problem, the better."
*   Elaborate architectures may lead to solving problems that don't exist yet. Build iteratively and refactor based on real pain points.
*   **Note:** Architecture should trail product development, not lead it.

### Programming Paradigms
*   **Imperative Programming:** State exists outside functions and is often managed globally.
*   **Object-Oriented Programming (Without Classes):** Use functions and closures to encapsulate behavior. Dependency injection and composition can replace classical inheritance.
*   **Functional Programming:** Favor small, pure functions that minimize mutable state. This reduces moving parts and improves testability.

---

## GRUG's Guidelines

1.  **Generics:** Use caution. Limit generics to container classes where they add the most value.
2.  **Closures:** Good for abstracting operations over collections, but use sparingly.
3.  **Logging:**
    *   Log major logical branches (if/for).
    *   Include request IDs for distributed requests.
    *   Use dynamic log levels and per-user logging for debugging.
4.  **Parsing:** Recursive descent is preferred.
5.  **Concurrency:** Prefer simple models like stateless handlers or independent job queues.
6.  **Testing:**
    *   Write tests after the prototype firms up.
    *   **Integration Tests:** The sweet spot; high-level correctness but low-level enough to debug.
    *   **E2E Tests:** Maintain a small, curated suite for common features and edge cases.
7.  **Mocking:** Avoid if possible. If necessary, keep it coarse-grained at system boundaries.
8.  **Refactoring:** Keep steps small. The system should work at all times.
9.  **Microservices:** Avoid introducing network calls unless necessary; they add significant complexity.

---

## Critique of SOLID Principles

*   **Single Responsibility Principle (SRP):** Can be antagonistic to locality of behavior. Too much fragmentation forces developers to jump between files. Air on the side of locality.
*   **Open/Closed Principle (OCP):** Often leads to over-abstraction for future requirements that never materialize.
*   **Liskov Substitution Principle (LSP):** Inheritance hierarchies are difficult to design and create tight coupling. Favor composition.
*   **Interface Segregation Principle (ISP):** Generally good. Keep interfaces thin and focused.
*   **Dependency Inversion Principle (DIP):** Generally good. Depend on interfaces/abstractions to keep architecture flat.

---



## Object-Oriented Design Without Classes

This section demonstrates multiple approaches to encapsulate behavior and state without using classes.

```typescript
/* ------------------------------ */
/* Example 1: Closure-based Book  */
/* ------------------------------ */

/**
 * Creates a book object with private state.
 * Each call to `read` returns a new instance with an incremented read count.
 */
export const createBook = (
  authorName: string,
  bookTitle: string,
  initialReadCount: number = 0
) => {
  const author: string = authorName;
  const title: string = bookTitle;
  const readCount: number = initialReadCount;

  const read = (): ReturnType<typeof createBook> => {
    console.log("This is a good book!");
    // Returns a new book instance with an incremented read count.
    return createBook(author, title, readCount + 1);
  };

  const getReadCount = (): number => readCount;

  return {
    read,
    getReadCount,
  };
};

// Usage of Example 1
const myFirstBook = createBook("Gabriel Rumbaut", "Cats Are Better Than Dogs");
console.log(myFirstBook.getReadCount()); // 0
const updatedBook1 = myFirstBook.read();
console.log(updatedBook1.getReadCount()); // 0 (new instance with increased count)

/* ------------------------------------------------- */
/* Example 2: Functional Approach with Currying    */
/* ------------------------------------------------- */

interface Book {
  author: string;
  title: string;
  readCount: number;
}

const createBookImmutable = ({
  author,
  title,
}: {
  author: string;
  title: string;
}): Book => ({
  author,
  title,
  readCount: 0,
});

const incrementReadCount =
  (increment: number) =>
  (book: Book): Book => ({
    ...book,
    readCount: book.readCount + increment,
  });

const readImmutable =
  (message: string) =>
  (book: Book): Book => {
    console.log(message);
    return incrementReadCount(1)(book);
  };

const getReadCountImmutable = (book: Book): number => book.readCount;

// Usage of Example 2
const mySecondBook: Book = createBookImmutable({
  author: "Gabriel Rumbaut",
  title: "Cats Are Better Than Dogs",
});

console.log(getReadCountImmutable(mySecondBook)); // 0
const updatedBook2 = readImmutable("This is a good book!")(mySecondBook); // Logs message, returns book with readCount incremented
console.log(updatedBook2.readCount); // 1
const incrementedBook = incrementReadCount(1)(mySecondBook); // Returns book with readCount increased by 1
console.log(incrementedBook.readCount); // 1

/* ----------------------------------------------- */
/* Example 3: Higher-Order Function for Greeting   */
/* ----------------------------------------------- */

function createGreeter(greeting: string): (name: string) => void {
  return function (name: string): void {
    console.log(`${greeting}, ${name}!`);
  };
}

const greetHello = createGreeter("Hello");
greetHello("John"); // Output: Hello, John!
```

---

## Inheritance vs. Composition (Without Classes)

TypeScript enables sharing behavior without classes by using container functions and object composition.

### Composition Example

```typescript
// Define individual behaviors as functions with their return types:
type Pushable = {
  push: () => void;
};

type Convertible = {
  convert: () => void;
};

const createPushable = (): Pushable => ({ 
  push: () => console.log("Pushing...") 
});

const createConvertible = (): Convertible => ({ 
  convert: () => console.log("Converting...") 
});

// Compose a new object by merging behaviors:
type Converter = Pushable & Convertible;

const createConverter = (): Converter => ({ 
  ...createPushable(), 
  ...createConvertible() 
});

// Usage: 
const converter = createConverter(); 
converter.push(); // Output: Pushing... 
converter.convert(); // Output: Converting...
```

### Pseudo-Inheritance via Composition

```typescript
// Base behavior (akin to a "superclass")
type PushableBase = {
  push: () => void;
};

const createPushableBase = (): PushableBase => ({ 
  push: () => console.log("Pushing...") 
});

// "Derived" behavior by composing with base:
type ConvertibleDerived = PushableBase & {
  convert: () => void;
};

const createConvertibleDerived = (): ConvertibleDerived => { 
  const base = createPushableBase(); // Inherit push behavior 
  return { 
    ...base, 
    convert: () => console.log("Converting...") 
  }; 
};

// Usage: 
const convertible = createConvertibleDerived(); 
convertible.push(); // Output: Pushing... 
convertible.convert(); // Output: Converting...
```

---

## Strategy Pattern with Dependency Injection

This section demonstrates how to replace conditional logic with function-based strategy objects. We build storage strategies (SFTP, S3, Local) and apply dependency injection via a factory and decorator—all without using classes.

```typescript
// Step 1: Define the Strategy Interface
interface File {
  name: string;
  content: string;
}

interface StorageStrategy {
  upload: (file: File) => Promise<string>;
}

// Step 2: Implement Concrete Strategies
const SftpStorage: StorageStrategy = { 
  upload: async (file: File): Promise<string> => { 
    console.log("Uploading via SFTP..."); 
    return Promise.resolve(`sftp://server/${file.name}`); 
  } 
};

const S3Storage: StorageStrategy = { 
  upload: async (file: File): Promise<string> => { 
    console.log("Uploading to S3..."); 
    return Promise.resolve(`s3://bucket/${file.name}`); 
  } 
};

const LocalStorage: StorageStrategy = { 
  upload: async (file: File): Promise<string> => { 
    console.log("Saving to local storage..."); 
    return Promise.resolve(`/local/path/${file.name}`); 
  } 
};

// Step 3: Create a Storage Factory
type StorageType = 'sftp' | 's3' | 'local';

const createStorageStrategy = (type: StorageType): StorageStrategy => { 
  switch (type) { 
    case 'sftp': 
      return SftpStorage; 
    case 's3': 
      return S3Storage; 
    case 'local': 
      return LocalStorage; 
    default: 
      throw new Error("Unsupported storage type"); 
  } 
};

// Step 4: Add a Logging Decorator
const withLogging = (strategy: StorageStrategy): StorageStrategy => ({ 
  upload: async (file: File): Promise<string> => { 
    console.log(`Starting upload for: ${file.name}`); 
    const result = await strategy.upload(file); 
    console.log(`Finished upload. Result: ${result}`); 
    return result; 
  } 
});

// Step 5: Dependency Injection in a Consumer
interface FileUploader {
  uploadFile: (file: File) => Promise<string>;
}

const createFileUploader = (storageStrategy: StorageStrategy): FileUploader => ({ 
  uploadFile: async (file: File): Promise<string> => await storageStrategy.upload(file) 
});

// Step 6: Usage
const storageType: StorageType = 's3'; // Options: 'sftp', 's3', 'local'
const strategy = withLogging(createStorageStrategy(storageType));
const uploader = createFileUploader(strategy);

const file: File = { name: "example.txt", content: "Sample content" };
uploader.uploadFile(file).then((result) => console.log("Upload completed:", result));
```

---

## Domain Models & Cross-Cutting Concerns

Separate your core data structures from cross-cutting concerns like logging, validation, and error handling.

### Domain Models (domainModels.ts)
```typescript
export type Post = { 
  id: string; 
  name: string; 
};

export type Author = { 
  id: string; 
  posts: Post[]; 
};

export const createPost = (name: string, id: string): Post => ({ name, id }); 
export const createAuthor = (id: string, posts: Post[] = []): Author => ({ id, posts });
```

### Business Logic (authorService.ts)
```typescript
import { Author, createAuthor, createPost } from './domainModels';

const authors: Author[] = [];

export const addAuthor = (authorId: string): Author => { 
  const author = createAuthor(authorId); 
  authors.push(author); 
  return author; 
};

export const addPostToAuthor = (authorId: string, postName: string, postId: string): Author | undefined => { 
  const author = authors.find(a => a.id === authorId); 
  if (!author) { 
    console.error(`Author with id ${authorId} not found.`); 
    return undefined; 
  } 
  const post = createPost(postName, postId); 
  author.posts.push(post); 
  return author; 
};

export const getAllAuthors = (): Author[] => authors;
```

---

## Design Patterns & Functional Practices

### Builder Pattern (Without a Builder Class)
```typescript
interface UserProps {
  name: string;
  age: number;
  phone?: string;
  address: {
    street: string;
    city: string;
  };
}

interface User extends UserProps {}

const createUser = ({ name, age, phone = '1234567890', address }: UserProps): User => ({ 
  name, 
  age, 
  phone, 
  address 
});

// Usage
const user = createUser({ 
  name: 'Bob', 
  age: 30, 
  phone: '11111', 
  address: { street: '1', city: 'Main' } 
});
```

### Avoid Flags as Parameters
```typescript
// Bad
function createUser(name: string, isAdmin: boolean) { ... }

// Better
function createRegularUser(name: string) { return { name, role: 'user' }; }
function createAdminUser(name: string) { return { name, role: 'admin' }; }
```

### Default Objects
```typescript
interface Config { theme?: string; notifications?: boolean; }

const createConfig = (userConfig: Config): Required<Config> => {
  const defaults = { theme: 'light', notifications: true };
  return { ...defaults, ...userConfig } as Required<Config>;
};
```

### Higher-Order & Container Functions
```typescript
interface Counter {
  increment: () => number;
  decrement: () => number;
  getCount: () => number;
}

function createCounter(initialValue: number = 0): Counter { 
  let count = initialValue; 
  return { 
    increment: () => ++count, 
    decrement: () => --count, 
    getCount: () => count 
  }; 
}
```

### Guard Clauses & Immutability
```typescript
// Guard clauses
function findUserById(id: string | null, users: User[] | null): User | null {
  if (!id) return null;
  if (!users || users.length === 0) return null;
  return users.find(user => user.id === id) || null;
}

// Immutability
const addItem = <T>(array: T[], item: T): T[] => [...array, item];
const updateUser = (user: User, updates: Partial<User>): User => ({ ...user, ...updates });
```

---

## Finite State Machines in TypeScript

FSMs explicitly define possible transitions to manage complexity.

```typescript
type MarioState = 'normal' | 'super' | 'fire' | 'invincible';
type MarioEvent = 'GET_MUSHROOM' | 'GET_FIRE_FLOWER' | 'GET_STAR' | 'HIT_OBSTACLE';

interface StateTransitions {
  on: Record<MarioEvent, MarioState>;
}

interface StateMachine {
  initial: MarioState;
  states: Record<MarioState, StateTransitions>;
  transition: (state: MarioState, event: MarioEvent) => MarioState;
}

const marioStateMachine: StateMachine = { 
  initial: 'normal', 
  states: { 
    normal: { 
      on: { 
        GET_MUSHROOM: 'super', 
        GET_FIRE_FLOWER: 'fire', 
        GET_STAR: 'invincible',
        HIT_OBSTACLE: 'normal'
      } 
    }, 
    super: { 
      on: { 
        GET_FIRE_FLOWER: 'fire', 
        HIT_OBSTACLE: 'normal',
        GET_MUSHROOM: 'super',
        GET_STAR: 'invincible'
      } 
    }, 
    fire: { 
      on: { 
        HIT_OBSTACLE: 'normal',
        GET_MUSHROOM: 'fire',
        GET_FIRE_FLOWER: 'fire',
        GET_STAR: 'invincible'
      } 
    }, 
    invincible: { 
      on: { 
        HIT_OBSTACLE: 'normal',
        GET_MUSHROOM: 'invincible',
        GET_FIRE_FLOWER: 'invincible',
        GET_STAR: 'invincible'
      } 
    } 
  }, 
  transition: function(state: MarioState, event: MarioEvent): MarioState { 
    return this.states[state]?.on[event] || state; 
  } 
};
```

---

## Naming, Testing & Utils

### Naming Conventions
*   **Variable Naming:** Use clear, descriptive names. Include units.
    ```typescript
    const MILLISECONDS_PER_DAY: number = 60 * 60 * 24 * 1000;
    ```
*   **Avoid abbreviations:** `movie.genre` instead of `m.gen`.
*   **File Naming:** Prefer descriptive module names over generic ones like `utils.ts`.

### Testing Strategies
1.  **Unit Tests:** For critical, pure functions.
2.  **Integration Tests:** For systems like queues or batch processes.
3.  **End-to-End (E2E):** For user interactions.
*   **Approach:** Use TDD for libraries and behavior-driven testing for interactive applications.

### Common Array Methods
*   **map()**: Transform elements.
*   **filter()**: Select elements.
*   **reduce()**: Accumulate values.
*   **find()**: Return first match.
*   **some() / every()**: Boolean checks.
