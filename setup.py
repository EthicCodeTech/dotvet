from setuptools import setup, find_packages

with open("README.md", "r", encoding="utf-8") as f:
    long_description = f.read()

setup(
    name="dotvet",
    version="0.1.0",
    description="Zero-config environment variable security scanner & quality gate.",
    long_description=long_description,
    long_description_content_type="text/markdown",
    author="EthicCode Technologies",
    author_email="contact@ethiccode.in",
    license="MIT",
    url="https://github.com/EthicCodes/dotvet",
    packages=find_packages(include=["dotvet", "dotvet.*"]),
    python_requires=">=3.8",
    entry_points={
        "console_scripts": [
            "dotvet = dotvet.cli:main",
        ],
    },
    classifiers=[
        "Development Status :: 4 - Beta",
        "Environment :: Console",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Topic :: Security",
        "Topic :: Software Development :: Quality Assurance",
    ],
)
