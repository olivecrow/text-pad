export interface EditorCommand<TInput> {
  readonly id: string;
  readonly priority: number;
  readonly execute: (input: TInput) => boolean;
}

function validateCommands<TInput>(commands: readonly EditorCommand<TInput>[]): void {
  const ids = new Set<string>();
  const priorities = new Set<number>();

  for (const command of commands) {
    if (command.id.trim().length === 0) {
      throw new Error('Editor command ids must not be empty.');
    }
    if (ids.has(command.id)) {
      throw new Error(`Duplicate editor command id: ${command.id}`);
    }
    if (!Number.isSafeInteger(command.priority)) {
      throw new Error(`Editor command priorities must be safe integers: ${command.id}`);
    }
    if (priorities.has(command.priority)) {
      throw new Error(`Duplicate editor command priority: ${command.priority}`);
    }

    ids.add(command.id);
    priorities.add(command.priority);
  }
}

export class EditorCommandPipeline<TInput> {
  private readonly commands: readonly EditorCommand<TInput>[];

  constructor(commands: readonly EditorCommand<TInput>[]) {
    validateCommands(commands);
    this.commands = Object.freeze(
      [...commands].sort((left, right) => left.priority - right.priority)
    );
  }

  execute(input: TInput): string | null {
    for (const command of this.commands) {
      if (command.execute(input)) return command.id;
    }
    return null;
  }

  getOrderedCommandIds(): readonly string[] {
    return this.commands.map((command) => command.id);
  }
}
