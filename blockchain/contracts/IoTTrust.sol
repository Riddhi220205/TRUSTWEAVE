// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract IoTTrust {
    address public owner;

    struct Device {
        string deviceId;
        uint256 trustScore;
        bool compromised;
    }

    struct Incident {
        string bugType;
        string description;
        string recovery;
        uint256 timestamp;
        
    }

    mapping(string => Device) public devices;
    mapping(string => Incident[]) public incidents;

    // Enables the backend to retrieve every registered device after restart.
    string[] private deviceIds;
    mapping(string => bool) public deviceExists;

    event DeviceRegistered(string deviceId);
    event TrustUpdated(string deviceId, uint256 score);
    event DeviceCompromised(string deviceId);
    event IncidentAdded(string deviceId, string bugType);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner allowed");
        _;
    }

    modifier deviceRegistered(string memory deviceId) {
        require(deviceExists[deviceId], "Device not registered");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function registerDevice(
        string memory deviceId
    ) public onlyOwner {
        require(bytes(deviceId).length > 0, "Device ID is required");
        require(!deviceExists[deviceId], "Device already registered");

        devices[deviceId] = Device({
            deviceId: deviceId,
            trustScore: 100,
            compromised: false
        });

        deviceIds.push(deviceId);
        deviceExists[deviceId] = true;

        emit DeviceRegistered(deviceId);
    }

    function updateTrustScore(
        string memory deviceId,
        uint256 score
    ) public onlyOwner deviceRegistered(deviceId) {
        require(score <= 100, "Trust score must be between 0 and 100");

        devices[deviceId].trustScore = score;

        emit TrustUpdated(deviceId, score);
    }

    function markCompromised(
        string memory deviceId
    ) public onlyOwner deviceRegistered(deviceId) {
        devices[deviceId].compromised = true;

        emit DeviceCompromised(deviceId);
    }

    function addIncident(
        string memory deviceId,
        string memory bugType,
        string memory description,
        string memory recovery
    ) public onlyOwner deviceRegistered(deviceId) {
        incidents[deviceId].push(
            Incident({
                bugType: bugType,
                description: description,
                recovery: recovery,
                timestamp: block.timestamp
            })
        );

        emit IncidentAdded(deviceId, bugType);
    }

    function getIncidentCount(
        string memory deviceId
    ) public view returns (uint256) {
        return incidents[deviceId].length;
    }

    function getDeviceIds() public view returns (string[] memory) {
        return deviceIds;
    }

    function getDeviceCount() public view returns (uint256) {
        return deviceIds.length;
    }
}