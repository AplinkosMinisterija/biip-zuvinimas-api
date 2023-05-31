# BĮIP Žuvinimas API

[![License](https://img.shields.io/github/license/AplinkosMinisterija/biip-zuvinimas-api)](https://github.com/AplinkosMinisterija/biip-zuvinimas-api/blob/main/LICENSE)
[![GitHub issues](https://img.shields.io/github/issues/AplinkosMinisterija/biip-zuvinimas-api)](https://github.com/AplinkosMinisterija/biip-zuvinimas-api/issues)
[![GitHub stars](https://img.shields.io/github/stars/AplinkosMinisterija/biip-zuvinimas-api)](https://github.com/AplinkosMinisterija/biip-zuvinimas-api/stargazers)

This repository contains the source code and documentation for the BĮIP Žuvinimas API, developed by the Aplinkos Ministerija.

## Table of Contents

- [About the Project](#about-the-project)
- [Getting Started](#getting-started)
  - [Installation](#installation)
  - [Usage](#usage)
- [Contributing](#contributing)
- [License](#license)

## About the Project

The BĮIP Žuvinimas API is designed to provide information and functionalities related to fish stocking activities. It aims to support the management and conservation of fish populations, as well as the sustainability of fishing practices.

Key features of the API include:

- Retrieving fish stocking data, such as planned fish stockings and historical information.
- Managing fish stocking data.

## Getting Started

To get started with the BĮIP Žuvinimas API, follow the instructions below.

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/AplinkosMinisterija/biip-zuvinimas-api.git
   ```

2. Install the required dependencies:

   ```bash
   cd biip-zuvinimas-api
   yarn install
   ```

### Usage

1. Set up the required environment variables. Copy the `.env.example` file to `.env` and provide the necessary values for the variables.

2. Start the API server:

   ```bash
   yarn dc:up
   yarn dev
   ```

   The API will be available at `http://localhost:3000`.

## Contributing

Contributions are welcome! If you find any issues or have suggestions for improvements, please open an issue or submit a pull request. For more information, see the [contribution guidelines](./CONTRIBUTING.md).

## License

This project is licensed under the [MIT License](./LICENSE).
