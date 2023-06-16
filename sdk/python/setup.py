# -*- coding: utf-8 -*-
from setuptools import setup

packages = \
['symbolchain',
   'symbolchain.facade',
   'symbolchain.nc',
   'symbolchain.nem',
   'symbolchain.external',
   'symbolchain.sc',
   'symbolchain.symbol']

package_data = \
{'': ['*']}

with open('requirements.txt') as f:
    requirements = f.read().splitlines()

setup_kwargs = {
    'name': 'techbureau-symbol-sdk-python',
    'version': '3.0.7.dev2',
    'description': 'Symbol SDK',
    'long_description': 'This is symbol project core sdk python library.',
    'author': 'Techbureau Contributors',
    'author_email': 'development@techbureau.jp',
    'maintainer': 'Techbureau Contributors',
    'maintainer_email': 'development@techbureau.jp',
    'url': 'https://github.com/tech-bureau-jp/symbol/tree/dev/sdk/python',
    'packages': packages,
    'package_data': package_data,
    'install_requires': requirements,
    'python_requires': '>=3.7,<4.0',
}

setup(**setup_kwargs)
