import re
from enum import Enum


class ParserState(Enum):
	UNDEFINED = 0
	COLLECTING = 1


def parse_code(infile):
	"""Parses sdk/python/examples/docs/__main__.py, creates function name -> code mapping."""

	func_pattern = re.compile(r'(async )?def (?P<func_name>\w+)')
	parsed_code = {}

	# this is super _crude_, it only handles func starting at the beginning of line
	method_name = None
	method_lines = []
	parser_state = ParserState.UNDEFINED

	def add_method():
		nonlocal method_name
		nonlocal method_lines
		nonlocal parsed_code

		if not method_name:
			return

		# remove empty lines at the end
		while not method_lines[-1]:
			method_lines.pop()

		parsed_code[method_name] = method_lines
		method_lines = []
		method_name = None

	for line in infile:
		line = line.rstrip('\n')
		if re.match(r'^[^\t\n]', line):
			parser_state = ParserState.UNDEFINED
			add_method()

		if parser_state == ParserState.UNDEFINED:
			match = re.match(func_pattern, line)
			if match:
				# there is already a collected method, save it
				add_method()

				method_name = match.group('func_name')
				method_lines.append(line)
				parser_state = ParserState.COLLECTING

		elif parser_state == ParserState.COLLECTING:
			method_lines.append(line)

	return parsed_code


def insert_fenced_example(outfile, lines):
	outfile.write('```python\n')
	for line in lines:
		outfile.write(f'{line}\n')
	outfile.write('```\n')


def process(parsed_code, infile, outfile):
	"""Parse big.md file, inserting !inline-s and !example-s."""
	processor_pattern = re.compile(r'^(?P<command>!inline|!example) (?P<name>.*)')

	for line in infile:
		match = re.match(processor_pattern, line)

		if match:
			command = match.group('command')
			name = match.group('name')
			if '!inline' == command:
				with open(f'{name}.md', 'r', encoding='utf8') as inlined_file:
					process(parsed_code, inlined_file, outfile)
			elif '!example' == command:
				insert_fenced_example(outfile, parsed_code[name])
		else:
			outfile.write(line)


def main():
	with open('../sdk/python/examples/docs/__main__.py', 'r', encoding='utf8') as infile:
		parsed_code = parse_code(infile)

	with open('big.md', 'r', encoding='utf8') as infile:
		with open('index.md', 'w', encoding='utf8') as outfile:
			process(parsed_code, infile, outfile)


if '__main__' == __name__:
	main()
