import hashlib

from ripemd import ripemd160 as ripemd160_impl


def _factory():
	try:
		hasher = hashlib.new('ripemd160')
	except ValueError:
		hasher = ripemd160_impl.new()

	return hasher


def ripemd160(data):
	"""Calculates RIPEMD-160 hash of data."""

	builder = _factory()
	builder.update(data)
	return builder.digest()
