/**
 * Shared CLI argument parsing utilities
 */

// Known flags that should be treated as boolean flags (no value expected)
const KNOWN_FLAGS = new Set(['dry-run', 'verbose', 'v', 'd', 'help', 'h', 'force', 'f', 'all']);

export interface ParsedArgs {
	flags: Set<string>;
	values: Map<string, string>;
	positional: string[];
}

/**
 * Parse command line arguments
 * Supports:
 * - Flags: --dry-run, --verbose
 * - Named values: --limit=10, --limit 10
 * - Positional arguments
 */
export function parseArgs(argv: string[] = process.argv.slice(2)): ParsedArgs {
	const flags = new Set<string>();
	const values = new Map<string, string>();
	const positional: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];

		if (arg.startsWith('--')) {
			const withoutDashes = arg.slice(2);

			// Check for --name=value format
			if (withoutDashes.includes('=')) {
				const [name, value] = withoutDashes.split('=', 2);
				values.set(name, value);
			} else {
				// Check if it's a known flag (no value expected)
				if (KNOWN_FLAGS.has(withoutDashes)) {
					flags.add(withoutDashes);
				} else {
					// Check if next arg is a value (doesn't start with -)
					const nextArg = argv[i + 1];
					if (nextArg && !nextArg.startsWith('-')) {
						values.set(withoutDashes, nextArg);
						i++; // Skip the value
					} else {
						// It's a flag
						flags.add(withoutDashes);
					}
				}
			}
		} else if (arg.startsWith('-')) {
			// Short flags like -v, -d
			flags.add(arg.slice(1));
		} else {
			positional.push(arg);
		}
	}

	return { flags, values, positional };
}

/**
 * Get a flag value (returns true if flag exists)
 */
export function hasFlag(args: ParsedArgs, name: string): boolean {
	return args.flags.has(name);
}

/**
 * Get a named value with optional default
 */
export function getValue(
	args: ParsedArgs,
	name: string,
	defaultValue?: string
): string | undefined {
	return args.values.get(name) ?? defaultValue;
}

/**
 * Get a named value as integer
 */
export function getIntValue(
	args: ParsedArgs,
	name: string,
	defaultValue?: number
): number | undefined {
	const value = args.values.get(name);
	if (value === undefined) {
		return defaultValue;
	}
	const parsed = parseInt(value, 10);
	return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Get positional argument by index
 */
export function getPositional(
	args: ParsedArgs,
	index: number,
	defaultValue?: string
): string | undefined {
	return args.positional[index] ?? defaultValue;
}

// Alias for getPositional
export const getPositionalArg = getPositional;

/**
 * Get positional argument as integer
 */
export function getPositionalInt(
	args: ParsedArgs,
	index: number,
	defaultValue?: number
): number | undefined {
	const value = args.positional[index];
	if (value === undefined) {
		return defaultValue;
	}
	const parsed = parseInt(value, 10);
	return isNaN(parsed) ? defaultValue : parsed;
}
