const hre=require("hardhat");


async function main(){


const IoTTrust =
await hre.ethers.deployContract(
"IoTTrust"
);


await IoTTrust.waitForDeployment();


console.log(
"Contract deployed:",
await IoTTrust.getAddress()
);


}


main()
.catch(
(error)=>{
console.error(error);
process.exitCode=1;
}
);