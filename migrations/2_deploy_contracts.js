/*** Dependencies ********************/


const pako = require('pako');


/*** Settings ************************/


const config = require('../truffle.js');


/*** Utility Methods *****************/


// Compress / decompress ABIs
function compressABI(abi) {
  return Buffer.from(pako.deflate(JSON.stringify(abi))).toString('base64');
}
function decompressABI(abi) {
  return JSON.parse(pako.inflate(Buffer.from(abi, 'base64'), {to: 'string'}));
}

// Load ABI files and parse
function loadABI(abiFilePath) {
  return JSON.parse(config.fs.readFileSync(abiFilePath));
}


/*** Contracts ***********************/


// Storage
const rocketStorage = artifacts.require('RocketStorage.sol');

// Network contracts
const contracts = {
  // Core
  rocketRole:               artifacts.require('RocketRole.sol'),
  rocketVault:              artifacts.require('RocketVault.sol'),
  rocketUpgrade:            artifacts.require('RocketUpgrade.sol'),
  // Deposit
  rocketDepositPool:        artifacts.require('RocketDepositPool.sol'),
  // Minipool
  rocketMinipoolFactory:    artifacts.require('RocketMinipoolFactory.sol'),
  rocketMinipoolManager:    artifacts.require('RocketMinipoolManager.sol'),
  rocketMinipoolQueue:      artifacts.require('RocketMinipoolQueue.sol'),
  rocketMinipoolStatus:     artifacts.require('RocketMinipoolStatus.sol'),
  // Network
  rocketNetworkBalances:    artifacts.require('RocketNetworkBalances.sol'),
  rocketNetworkFees:        artifacts.require('RocketNetworkFees.sol'),
  rocketNetworkWithdrawal:  artifacts.require('RocketNetworkWithdrawal.sol'),
  // Node
  rocketNodeDeposit:        artifacts.require('RocketNodeDeposit.sol'),
  rocketNodeManager:        artifacts.require('RocketNodeManager.sol'),
  // Settings
  rocketDepositSettings:    artifacts.require('RocketDepositSettings.sol'),
  rocketMinipoolSettings:   artifacts.require('RocketMinipoolSettings.sol'),
  rocketNetworkSettings:    artifacts.require('RocketNetworkSettings.sol'),
  rocketNodeSettings:       artifacts.require('RocketNodeSettings.sol'),
  // Tokens
  rocketETHToken:           artifacts.require('RocketETHToken.sol'),
  rocketNodeETHToken:       artifacts.require('RocketNodeETHToken.sol'),
  // Utils
  addressQueueStorage:      artifacts.require('AddressQueueStorage.sol'),
  addressSetStorage:        artifacts.require('AddressSetStorage.sol'),
};

// Instance contract ABIs
const abis = {
  // Minipool
  rocketMinipool:           artifacts.require('RocketMinipool.sol'),
};


/*** Deployment **********************/


// Deploy Rocket Pool
module.exports = async (deployer, network) => {

  // Truffle add '-fork' for some reason when deploying to actual testnets
  network = network.replace("-fork", "");

  // Set our web3 provider
  let $web3 = new config.web3('http://' + config.networks[network].host + ':' + config.networks[network].port);
  console.log(`Web3 1.0 provider using network: `+network);
  console.log('\n');

  // Accounts
  let accounts = await $web3.eth.getAccounts(function(error, result) {
    if(error != null) {
      console.log(error);
      console.log("Error retrieving accounts.'");
    }
    return result;
  });


  // Live deployment
  if ( network == 'live' ) {
    // Casper live contract address
    let casperDepositAddress = '0XADDLIVECASPERADDRESS';
    // Add our live RPL token address in place
    contracts.rocketPoolToken.address = '0xb4efd85c19999d84251304bda99e90b92300bd93';
  }

  // Goerli test network
  else if (network == 'goerli') {

    // Casper deposit contract details
    const casperDepositAddress = '0x07b39f4fde4a38bace212b546dac87c58dfe3fdc';
    const casperDepositABI = loadABI('./contracts/contract/casper/compiled/Deposit.abi');
    contracts.casperDeposit = {
          address: casperDepositAddress,
              abi: casperDepositABI,
      precompiled: true
    };

  }

  // Test network deployment
  else {

    // Precompiled - Casper Deposit Contract
    const casperDepositABI = loadABI('./contracts/contract/casper/compiled/Deposit.abi');
    const casperDeposit = new $web3.eth.Contract(casperDepositABI, null, {
        from: accounts[0], 
        gasPrice: '20000000000' // 20 gwei
    });

    // Create the contract now
    const casperDepositContract = await casperDeposit.deploy(
      // Casper deployment 
      {               
        data: config.fs.readFileSync('./contracts/contract/casper/compiled/Deposit.bin')
      }).send({
          from: accounts[0], 
          gas: 8000000, 
          gasPrice: '20000000000'
      });

    // Set the Casper deposit address
    let casperDepositAddress = casperDepositContract._address;

    // Store it in storage
    contracts.casperDeposit = {
          address: casperDepositAddress,
              abi: casperDepositABI,
      precompiled: true
    };

  }


  // Deploy rocketStorage first - has to be done in this order so that the following contracts already know the storage address
  await deployer.deploy(rocketStorage);
  // Update the storage with the new addresses
  let rocketStorageInstance = await rocketStorage.deployed();
  // Deploy other contracts - have to be inside an async loop
  const deployContracts = async function() {
    for (let contract in contracts) {
      // Only deploy if it hasn't been deployed already like a precompiled
      if(!contracts[contract].hasOwnProperty('precompiled')) {
        await deployer.deploy(contracts[contract], rocketStorage.address);
      }
    }
  };
  // Run it
  await deployContracts();

  // Register all other contracts with storage and store their abi
  const addContracts = async function() {
    // Log RocketStorage
    console.log('\x1b[31m%s\x1b[0m:', '   Set Storage Address');
    console.log('     '+rocketStorage.address);
    for (let contract in contracts) {
      if(contracts.hasOwnProperty(contract)) {
        // Log it
        console.log('\x1b[31m%s\x1b[0m:', '   Set Storage '+contract+' Address');
        console.log('     '+contracts[contract].address);
        // Register the contract address as part of the network
        await rocketStorageInstance.setBool(
          $web3.utils.soliditySha3('contract.exists', contracts[contract].address),
          true
        );
        // Register the contract's name by address
        await rocketStorageInstance.setString(
          $web3.utils.soliditySha3('contract.name', contracts[contract].address),
          contract
        );
        // Register the contract's address by name
        await rocketStorageInstance.setAddress(
          $web3.utils.soliditySha3('contract.address', contract),
          contracts[contract].address
        );
        // Compress and store the ABI by name
        await rocketStorageInstance.setString(
          $web3.utils.soliditySha3('contract.abi', contract),
          compressABI(contracts[contract].abi)
        );
      } 
    }
  };

  // Register ABI-only contracts
  const addABIs = async function() {
    for (let contract in abis) {
      if(abis.hasOwnProperty(contract)) {
        console.log('\x1b[31m%s\x1b[0m:', '   Set Storage ABI');
        console.log('     '+contract);
        // Compress and store the ABI
        await rocketStorageInstance.setString(
          $web3.utils.soliditySha3('contract.abi', contract),
          compressABI(abis[contract].abi)
        );
      }
    }
  };

  // Set network withdrawal credentials
  const setWithdrawalCredentials = async function() {
    // Set withdrawal credentials
    const withdrawalCredentials = Buffer.from('0000000000000000000000000000000000000000000000000000000000000000', 'hex');
    const rocketNetworkWithdrawal = await contracts.rocketNetworkWithdrawal.deployed();
    await rocketNetworkWithdrawal.setWithdrawalCredentials(withdrawalCredentials);
    // Log
    console.log('\x1b[31m%s\x1b[0m:', '   Set Withdrawal Credentials');
    console.log('     '+'0x'+withdrawalCredentials.toString('hex'));
  }

  // Run it
  console.log('\x1b[34m%s\x1b[0m', '  Deploy Contracts');
  console.log('\x1b[34m%s\x1b[0m', '  ******************************************');
  await addContracts();
  console.log('\n');
  console.log('\x1b[34m%s\x1b[0m', '  Set ABI Only Storage');
  console.log('\x1b[34m%s\x1b[0m', '  ******************************************');
  await addABIs();
  console.log('\n');
  console.log('\x1b[34m%s\x1b[0m', '  Set Network Withdrawal Credentials');
  console.log('\x1b[34m%s\x1b[0m', '  ******************************************');
  await setWithdrawalCredentials();

  // Disable direct access to storage now
  await rocketStorageInstance.setBool(
    $web3.utils.soliditySha3('contract.storage.initialised'),
    true
  );
  // Log it
  console.log('\n');
  console.log('\x1b[32m%s\x1b[0m', '  Storage Direct Access For Owner Removed... Lets begin! :)');
  console.log('\n');  

};

