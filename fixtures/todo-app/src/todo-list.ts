import { InvalidTitleError, UnknownTodoError } from "./errors.js";
import type { Todo, TodoId } from "./todo.js";

/** Which todos a listing asks for. */
export type TodoFilter = "all" | "open" | "completed";

/**
 * A list of todos, held in memory, with ids it hands out itself.
 *
 * Insertion order is the list's order: `list` returns todos in the order they
 * were added, and adding never reorders what is already there.
 */
export class TodoList {
  private readonly todos = new Map<TodoId, Todo>();

  /** Add a todo with the given title, and answer the todo that was added. */
  add(title: string): Todo {
    const accepted = requireTitle(title);
    const todo: Todo = { id: this.mintId(), title: accepted, completed: false };
    this.todos.set(todo.id, todo);
    return todo;
  }

  /** The todo with that id, or a thrown `UnknownTodoError` if the list holds none. */
  get(id: TodoId): Todo {
    const todo = this.todos.get(id);
    if (todo === undefined) throw unknownTodo(id);
    return todo;
  }

  rename(id: TodoId, title: string): Todo {
    return this.replace({ ...this.get(id), title: requireTitle(title) });
  }

  complete(id: TodoId): Todo {
    return this.replace({ ...this.get(id), completed: true });
  }

  reopen(id: TodoId): Todo {
    return this.replace({ ...this.get(id), completed: false });
  }

  remove(id: TodoId): void {
    if (!this.todos.delete(id)) throw unknownTodo(id);
  }

  /** The todos the filter asks for, in the order they were added. */
  list(filter: TodoFilter = "all"): Todo[] {
    return [...this.todos.values()].filter((todo) => matches(todo, filter));
  }

  private replace(todo: Todo): Todo {
    this.todos.set(todo.id, todo);
    return todo;
  }

  /** The next unused id. Only a todo that is about to be added takes one. */
  private mintId(): TodoId {
    return String(this.todos.size + 1);
  }
}

function requireTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed === "") throw new InvalidTitleError("A todo needs a title with something in it.");
  return trimmed;
}

function unknownTodo(id: TodoId): UnknownTodoError {
  return new UnknownTodoError(`This list holds no todo with id ${id}.`);
}

function matches(todo: Todo, filter: TodoFilter): boolean {
  if (filter === "all") return true;
  if (filter === "open") return !todo.completed;
  return todo.completed;
}
