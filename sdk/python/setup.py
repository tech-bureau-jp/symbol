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

install_requires = \
['cryptography==38.0.1',
    'mnemonic==0.20',
    'Pillow==9.2.0',
    'pynacl==1.5.0',
    'pysha3==1.0.2',
    'PyYAML==6.0',
    'pyzbar==0.1.9',
    'ripemd-hash==1.0.0',
    'qrcode==7.3.1']

setup_kwargs = {
    'name': 'techbureau-symbol-sdk-python',
    'version': '3.0.3.dev3',
    'description': 'Symbol SDK',
    'long_description': 'This is symbol project core sdk python library.',
    'author': 'Techbureau Contributors',
    'author_email': 'development@techbureau.jp',
    'maintainer': 'Techbureau Contributors',
    'maintainer_email': 'development@techbureau.jp',
    'url': 'https://github.com/tech-bureau-jp/symbol/tree/dev/sdk/python',
    'packages': packages,
    'package_data': package_data,
    'install_requires': install_requires,
    'python_requires': '>=3.7,<4.0',
}

setup(**setup_kwargs)
