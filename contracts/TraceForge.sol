// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract TraceForge is Ownable {
    struct Tenant {
        bool exists;
        bool active;
        bytes32 metadataHash;
        uint64 createdAt;
    }

    struct Organization {
        bool exists;
        bool active;
        bytes32 metadataHash;
        uint64 createdAt;
    }

    struct WalletBinding {
        bytes32 organizationId;
        bool active;
    }

    struct TenantMembership {
        bool exists;
        bool active;
        uint64 joinedAt;
    }


    enum Capability {
        ENTITY_CREATE,
        TRACE_RECORD,
        STATE_UPDATE,
        METADATA_UPDATE,
        CUSTODY_TRANSFER,
        ENTITY_LINK,
        ENTITY_CLOSE
    }

    struct Role {
        bool exists;
        bool active;
        bytes32 metadataHash;
        uint256 capabilityMask;
        uint64 createdAt;
    }

    struct RoleAssignment {
        bool exists;
        bool active;
        uint64 assignedAt;
    }


    struct Entity {
        bytes32 entityType;
        bytes32 metadataHash;
        bytes32 currentState;
        bytes32 currentCustodian;
        uint64 createdAt;
        uint64 updatedAt;
        bool exists;
        bool closed;
    }


    struct CustodyTransfer {
        bytes32 fromOrganizationId;
        bytes32 toOrganizationId;
        address proposedBy;
        uint64 proposedAt;
        bool exists;
    }


    struct EntityLink {
        bytes32 sourceEntityId;
        bytes32 targetEntityId;
        bytes32 linkType;
        uint64 createdAt;
        uint64 updatedAt;
        bool exists;
        bool active;
    }

    mapping(bytes32 => Tenant) private tenants;

    mapping(bytes32 => Organization) private organizations;

    mapping(address => WalletBinding) private walletBindings;

    mapping(bytes32 => mapping(address => bool)) private tenantAdmins;

    mapping(bytes32 => mapping(bytes32 => TenantMembership))
        private tenantMemberships;


    mapping(bytes32 => mapping(bytes32 => Role))
        private roles;

    mapping(
        bytes32 =>
            mapping(
                bytes32 =>
                    mapping(bytes32 => RoleAssignment)
            )
    ) private organizationRoles;


    mapping(bytes32 => mapping(bytes32 => Entity))
        private entities;


    mapping(
        bytes32 =>
            mapping(bytes32 => CustodyTransfer)
    ) private pendingCustodyTransfers;


    mapping(bytes32 => mapping(bytes32 => EntityLink))
        private entityLinks;

    error InvalidTenantId();
    error InvalidOrganizationId();
    error InvalidWallet();

    error TenantAlreadyExists(bytes32 tenantId);
    error TenantNotFound(bytes32 tenantId);
    error TenantInactive(bytes32 tenantId);

    error OrganizationAlreadyExists(bytes32 organizationId);
    error OrganizationNotFound(bytes32 organizationId);
    error OrganizationInactive(bytes32 organizationId);

    error WalletAlreadyBound(
        address wallet,
        bytes32 organizationId
    );

    error WalletNotBound(address wallet);

    error NotTenantAdmin(
        bytes32 tenantId,
        address account
    );

    error TenantMembershipAlreadyExists(
        bytes32 tenantId,
        bytes32 organizationId
    );

    error TenantMembershipNotFound(
        bytes32 tenantId,
        bytes32 organizationId
    );


    error TenantMembershipInactive(
        bytes32 tenantId,
        bytes32 organizationId
    );

    error InvalidRoleId();

    error RoleAlreadyExists(
        bytes32 tenantId,
        bytes32 roleId
    );

    error RoleNotFound(
        bytes32 tenantId,
        bytes32 roleId
    );

    error RoleInactive(
        bytes32 tenantId,
        bytes32 roleId
    );

    error OrganizationRoleAlreadyExists(
        bytes32 tenantId,
        bytes32 organizationId,
        bytes32 roleId
    );

    error OrganizationRoleNotFound(
        bytes32 tenantId,
        bytes32 organizationId,
        bytes32 roleId
    );

    error MissingCapability(
        bytes32 tenantId,
        bytes32 roleId,
        Capability capability,
        address wallet
    );


    error InvalidEntityId();
    error InvalidEntityType();
    error InvalidEntityState();
    error InvalidMetadataHash();

    error EntityAlreadyExists(
        bytes32 tenantId,
        bytes32 entityId
    );

    error EntityNotFound(
        bytes32 tenantId,
        bytes32 entityId
    );


    error InvalidEventType();
    error InvalidEvidenceHash();

    error EntityStateUnchanged(
        bytes32 tenantId,
        bytes32 entityId,
        bytes32 state
    );

    error EntityMetadataUnchanged(
        bytes32 tenantId,
        bytes32 entityId,
        bytes32 metadataHash
    );


    error NotCurrentCustodian(
        bytes32 tenantId,
        bytes32 entityId,
        bytes32 expectedOrganizationId,
        bytes32 callerOrganizationId
    );

    error InvalidCustodyRecipient();

    error CustodyTransferAlreadyPending(
        bytes32 tenantId,
        bytes32 entityId
    );

    error CustodyTransferNotFound(
        bytes32 tenantId,
        bytes32 entityId
    );

    error NotCustodyRecipient(
        bytes32 tenantId,
        bytes32 entityId,
        bytes32 expectedOrganizationId,
        bytes32 callerOrganizationId
    );

    error CustodyChangedSinceProposal(
        bytes32 tenantId,
        bytes32 entityId
    );


    error InvalidLinkType();

    error SelfEntityLinkNotAllowed(
        bytes32 entityId
    );

    error EntityLinkAlreadyExists(
        bytes32 tenantId,
        bytes32 linkId
    );

    error EntityLinkNotFound(
        bytes32 tenantId,
        bytes32 linkId
    );

    error EntityLinkStatusUnchanged(
        bytes32 tenantId,
        bytes32 linkId,
        bool active
    );

    event TenantCreated(
        bytes32 indexed tenantId,
        bytes32 metadataHash,
        address indexed initialAdmin,
        uint64 createdAt
    );

    event TenantStatusChanged(
        bytes32 indexed tenantId,
        bool active
    );

    event TenantAdminChanged(
        bytes32 indexed tenantId,
        address indexed account,
        bool active
    );

    event OrganizationRegistered(
        bytes32 indexed organizationId,
        bytes32 metadataHash,
        uint64 createdAt
    );

    event OrganizationStatusChanged(
        bytes32 indexed organizationId,
        bool active
    );

    event WalletBound(
        address indexed wallet,
        bytes32 indexed organizationId
    );

    event WalletStatusChanged(
        address indexed wallet,
        bytes32 indexed organizationId,
        bool active
    );

    event OrganizationAddedToTenant(
        bytes32 indexed tenantId,
        bytes32 indexed organizationId,
        uint64 joinedAt
    );

    event TenantMembershipStatusChanged(
        bytes32 indexed tenantId,
        bytes32 indexed organizationId,
        bool active
    );


    event RoleCreated(
        bytes32 indexed tenantId,
        bytes32 indexed roleId,
        bytes32 metadataHash,
        uint64 createdAt
    );

    event RoleStatusChanged(
        bytes32 indexed tenantId,
        bytes32 indexed roleId,
        bool active
    );

    event RoleCapabilityChanged(
        bytes32 indexed tenantId,
        bytes32 indexed roleId,
        Capability indexed capability,
        bool enabled
    );

    event OrganizationRoleAssigned(
        bytes32 indexed tenantId,
        bytes32 indexed organizationId,
        bytes32 indexed roleId,
        uint64 assignedAt
    );

    event OrganizationRoleStatusChanged(
        bytes32 indexed tenantId,
        bytes32 indexed organizationId,
        bytes32 indexed roleId,
        bool active
    );


    event EntityCreated(
        bytes32 indexed tenantId,
        bytes32 indexed entityId,
        bytes32 indexed entityType,
        bytes32 organizationId,
        address actor,
        bytes32 metadataHash,
        bytes32 initialState,
        uint64 createdAt
    );


    event TraceRecorded(
        bytes32 indexed tenantId,
        bytes32 indexed entityId,
        bytes32 indexed eventType,
        bytes32 organizationId,
        bytes32 roleId,
        address actor,
        bytes32 evidenceHash,
        bytes32 stateAfter,
        bytes32 metadataHashAfter,
        uint64 timestamp
    );


    event CustodyTransferProposed(
        bytes32 indexed tenantId,
        bytes32 indexed entityId,
        bytes32 indexed fromOrganizationId,
        bytes32 toOrganizationId,
        bytes32 roleId,
        address actor,
        bytes32 eventType,
        bytes32 evidenceHash,
        uint64 proposedAt
    );

    event CustodyTransferCancelled(
        bytes32 indexed tenantId,
        bytes32 indexed entityId,
        bytes32 indexed fromOrganizationId,
        bytes32 toOrganizationId,
        bytes32 roleId,
        address actor,
        bytes32 eventType,
        bytes32 evidenceHash,
        uint64 cancelledAt
    );


    event CustodyTransferCancelledByAdmin(
        bytes32 indexed tenantId,
        bytes32 indexed entityId,
        bytes32 indexed fromOrganizationId,
        bytes32 toOrganizationId,
        address admin,
        bytes32 eventType,
        bytes32 evidenceHash,
        uint64 cancelledAt
    );


    event CustodyTransferred(
        bytes32 indexed tenantId,
        bytes32 indexed entityId,
        bytes32 indexed fromOrganizationId,
        bytes32 toOrganizationId,
        bytes32 roleId,
        address actor,
        bytes32 eventType,
        bytes32 evidenceHash,
        uint64 acceptedAt
    );


    event EntityLinkCreated(
        bytes32 indexed tenantId,
        bytes32 indexed linkId,
        bytes32 indexed sourceEntityId,
        bytes32 targetEntityId,
        bytes32 linkType,
        bytes32 organizationId,
        bytes32 roleId,
        address actor,
        bytes32 eventType,
        bytes32 evidenceHash,
        uint64 createdAt
    );

    event EntityLinkStatusChanged(
        bytes32 indexed tenantId,
        bytes32 indexed linkId,
        bytes32 indexed sourceEntityId,
        bytes32 targetEntityId,
        bytes32 linkType,
        bool active,
        bytes32 organizationId,
        bytes32 roleId,
        address actor,
        bytes32 eventType,
        bytes32 evidenceHash,
        uint64 updatedAt
    );

    constructor() Ownable(msg.sender) {}

    modifier onlyTenantAdmin(bytes32 tenantId) {
        _requireTenantExists(tenantId);

        if (!tenantAdmins[tenantId][msg.sender]) {
            revert NotTenantAdmin(
                tenantId,
                msg.sender
            );
        }

        _;
    }

    // ------------------------------------------------------------
    // Tenant
    // ------------------------------------------------------------

    function createTenant(
        bytes32 tenantId,
        bytes32 metadataHash,
        address initialAdmin
    ) external onlyOwner {
        if (tenantId == bytes32(0)) {
            revert InvalidTenantId();
        }

        if (initialAdmin == address(0)) {
            revert InvalidWallet();
        }

        if (tenants[tenantId].exists) {
            revert TenantAlreadyExists(tenantId);
        }

        uint64 createdAt = uint64(block.timestamp);

        tenants[tenantId] = Tenant({
            exists: true,
            active: true,
            metadataHash: metadataHash,
            createdAt: createdAt
        });

        tenantAdmins[tenantId][initialAdmin] = true;

        emit TenantCreated(
            tenantId,
            metadataHash,
            initialAdmin,
            createdAt
        );

        emit TenantAdminChanged(
            tenantId,
            initialAdmin,
            true
        );
    }

    function setTenantActive(
        bytes32 tenantId,
        bool active
    ) external onlyOwner {
        _requireTenantExists(tenantId);

        tenants[tenantId].active = active;

        emit TenantStatusChanged(
            tenantId,
            active
        );
    }

    function setTenantAdmin(
        bytes32 tenantId,
        address account,
        bool active
    ) external onlyOwner {
        _requireTenantExists(tenantId);

        if (account == address(0)) {
            revert InvalidWallet();
        }

        tenantAdmins[tenantId][account] = active;

        emit TenantAdminChanged(
            tenantId,
            account,
            active
        );
    }

    // ------------------------------------------------------------
    // Organization
    // ------------------------------------------------------------

    function registerOrganization(
        bytes32 organizationId,
        bytes32 metadataHash
    ) external onlyOwner {
        if (organizationId == bytes32(0)) {
            revert InvalidOrganizationId();
        }

        if (organizations[organizationId].exists) {
            revert OrganizationAlreadyExists(
                organizationId
            );
        }

        uint64 createdAt = uint64(block.timestamp);

        organizations[organizationId] = Organization({
            exists: true,
            active: true,
            metadataHash: metadataHash,
            createdAt: createdAt
        });

        emit OrganizationRegistered(
            organizationId,
            metadataHash,
            createdAt
        );
    }

    function setOrganizationActive(
        bytes32 organizationId,
        bool active
    ) external onlyOwner {
        _requireOrganizationExists(
            organizationId
        );

        organizations[organizationId].active = active;

        emit OrganizationStatusChanged(
            organizationId,
            active
        );
    }

    // ------------------------------------------------------------
    // Wallet identity
    // ------------------------------------------------------------

    function bindWallet(
        bytes32 organizationId,
        address wallet
    ) external onlyOwner {
        _requireOrganizationActive(
            organizationId
        );

        if (wallet == address(0)) {
            revert InvalidWallet();
        }

        bytes32 existingOrganizationId =
            walletBindings[wallet].organizationId;

        if (existingOrganizationId != bytes32(0)) {
            revert WalletAlreadyBound(
                wallet,
                existingOrganizationId
            );
        }

        walletBindings[wallet] = WalletBinding({
            organizationId: organizationId,
            active: true
        });

        emit WalletBound(
            wallet,
            organizationId
        );
    }

    function setWalletActive(
        address wallet,
        bool active
    ) external onlyOwner {
        WalletBinding storage binding =
            walletBindings[wallet];

        if (binding.organizationId == bytes32(0)) {
            revert WalletNotBound(wallet);
        }

        binding.active = active;

        emit WalletStatusChanged(
            wallet,
            binding.organizationId,
            active
        );
    }

    // ------------------------------------------------------------
    // Tenant membership
    // ------------------------------------------------------------

    function addOrganizationToTenant(
        bytes32 tenantId,
        bytes32 organizationId
    ) external onlyTenantAdmin(tenantId) {
        _requireTenantActive(tenantId);
        _requireOrganizationActive(
            organizationId
        );

        TenantMembership storage membership =
            tenantMemberships[tenantId][organizationId];

        if (membership.exists) {
            revert TenantMembershipAlreadyExists(
                tenantId,
                organizationId
            );
        }

        uint64 joinedAt = uint64(block.timestamp);

        tenantMemberships[tenantId][organizationId] =
            TenantMembership({
                exists: true,
                active: true,
                joinedAt: joinedAt
            });

        emit OrganizationAddedToTenant(
            tenantId,
            organizationId,
            joinedAt
        );
    }

    function setTenantMembershipActive(
        bytes32 tenantId,
        bytes32 organizationId,
        bool active
    ) external onlyTenantAdmin(tenantId) {
        TenantMembership storage membership =
            tenantMemberships[tenantId][organizationId];

        if (!membership.exists) {
            revert TenantMembershipNotFound(
                tenantId,
                organizationId
            );
        }

        if (active) {
            _requireTenantActive(tenantId);
            _requireOrganizationActive(
                organizationId
            );
        }

        membership.active = active;

        emit TenantMembershipStatusChanged(
            tenantId,
            organizationId,
            active
        );
    }

    // ------------------------------------------------------------

    // ------------------------------------------------------------
    // Roles and capabilities
    // ------------------------------------------------------------

    function createRole(
        bytes32 tenantId,
        bytes32 roleId,
        bytes32 metadataHash
    ) external onlyTenantAdmin(tenantId) {
        _requireTenantActive(tenantId);

        if (roleId == bytes32(0)) {
            revert InvalidRoleId();
        }

        if (roles[tenantId][roleId].exists) {
            revert RoleAlreadyExists(
                tenantId,
                roleId
            );
        }

        uint64 createdAt = uint64(block.timestamp);

        roles[tenantId][roleId] = Role({
            exists: true,
            active: true,
            metadataHash: metadataHash,
            capabilityMask: 0,
            createdAt: createdAt
        });

        emit RoleCreated(
            tenantId,
            roleId,
            metadataHash,
            createdAt
        );
    }

    function setRoleActive(
        bytes32 tenantId,
        bytes32 roleId,
        bool active
    ) external onlyTenantAdmin(tenantId) {
        _requireRoleExists(
            tenantId,
            roleId
        );

        if (active) {
            _requireTenantActive(tenantId);
        }

        roles[tenantId][roleId].active = active;

        emit RoleStatusChanged(
            tenantId,
            roleId,
            active
        );
    }

    function setRoleCapability(
        bytes32 tenantId,
        bytes32 roleId,
        Capability capability,
        bool enabled
    ) external onlyTenantAdmin(tenantId) {
        _requireTenantActive(tenantId);

        _requireRoleExists(
            tenantId,
            roleId
        );

        uint256 bit = _capabilityBit(
            capability
        );

        if (enabled) {
            roles[tenantId][roleId]
                .capabilityMask |= bit;
        } else {
            roles[tenantId][roleId]
                .capabilityMask &= ~bit;
        }

        emit RoleCapabilityChanged(
            tenantId,
            roleId,
            capability,
            enabled
        );
    }

    function assignRoleToOrganization(
        bytes32 tenantId,
        bytes32 organizationId,
        bytes32 roleId
    ) external onlyTenantAdmin(tenantId) {
        _requireTenantActive(tenantId);

        _requireOrganizationActive(
            organizationId
        );

        _requireActiveTenantMembership(
            tenantId,
            organizationId
        );

        _requireRoleActive(
            tenantId,
            roleId
        );

        RoleAssignment storage assignment =
            organizationRoles[
                tenantId
            ][
                organizationId
            ][
                roleId
            ];

        if (assignment.exists) {
            revert OrganizationRoleAlreadyExists(
                tenantId,
                organizationId,
                roleId
            );
        }

        uint64 assignedAt =
            uint64(block.timestamp);

        organizationRoles[
            tenantId
        ][
            organizationId
        ][
            roleId
        ] = RoleAssignment({
            exists: true,
            active: true,
            assignedAt: assignedAt
        });

        emit OrganizationRoleAssigned(
            tenantId,
            organizationId,
            roleId,
            assignedAt
        );
    }

    function setOrganizationRoleActive(
        bytes32 tenantId,
        bytes32 organizationId,
        bytes32 roleId,
        bool active
    ) external onlyTenantAdmin(tenantId) {
        RoleAssignment storage assignment =
            organizationRoles[
                tenantId
            ][
                organizationId
            ][
                roleId
            ];

        if (!assignment.exists) {
            revert OrganizationRoleNotFound(
                tenantId,
                organizationId,
                roleId
            );
        }

        if (active) {
            _requireTenantActive(tenantId);

            _requireOrganizationActive(
                organizationId
            );

            _requireActiveTenantMembership(
                tenantId,
                organizationId
            );

            _requireRoleActive(
                tenantId,
                roleId
            );
        }

        assignment.active = active;

        emit OrganizationRoleStatusChanged(
            tenantId,
            organizationId,
            roleId,
            active
        );
    }



    // ------------------------------------------------------------
    // Entities
    // ------------------------------------------------------------

    function createEntity(
        bytes32 tenantId,
        bytes32 roleId,
        bytes32 entityId,
        bytes32 entityType,
        bytes32 metadataHash,
        bytes32 initialState
    ) external {
        if (entityId == bytes32(0)) {
            revert InvalidEntityId();
        }

        if (entityType == bytes32(0)) {
            revert InvalidEntityType();
        }

        if (metadataHash == bytes32(0)) {
            revert InvalidMetadataHash();
        }

        if (initialState == bytes32(0)) {
            revert InvalidEntityState();
        }

        if (entities[tenantId][entityId].exists) {
            revert EntityAlreadyExists(
                tenantId,
                entityId
            );
        }

        _requireCapability(
            tenantId,
            roleId,
            Capability.ENTITY_CREATE
        );

        bytes32 organizationId =
            walletBindings[msg.sender]
                .organizationId;

        uint64 timestamp =
            uint64(block.timestamp);

        entities[tenantId][entityId] = Entity({
            entityType: entityType,
            metadataHash: metadataHash,
            currentState: initialState,
            currentCustodian: organizationId,
            createdAt: timestamp,
            updatedAt: timestamp,
            exists: true,
            closed: false
        });

        emit EntityCreated(
            tenantId,
            entityId,
            entityType,
            organizationId,
            msg.sender,
            metadataHash,
            initialState,
            timestamp
        );
    }



    // ------------------------------------------------------------
    // Trace, state and metadata evidence
    // ------------------------------------------------------------

    function recordTrace(
        bytes32 tenantId,
        bytes32 roleId,
        bytes32 entityId,
        bytes32 eventType,
        bytes32 evidenceHash
    ) external {
        _requireCapability(
            tenantId,
            roleId,
            Capability.TRACE_RECORD
        );

        _requireEntityExists(
            tenantId,
            entityId
        );

        _validateTraceEvidence(
            eventType,
            evidenceHash
        );

        _emitTrace(
            tenantId,
            entityId,
            roleId,
            eventType,
            evidenceHash
        );
    }

    function updateEntityState(
        bytes32 tenantId,
        bytes32 roleId,
        bytes32 entityId,
        bytes32 eventType,
        bytes32 newState,
        bytes32 evidenceHash
    ) external {
        _requireCapability(
            tenantId,
            roleId,
            Capability.STATE_UPDATE
        );

        _requireEntityExists(
            tenantId,
            entityId
        );

        _validateTraceEvidence(
            eventType,
            evidenceHash
        );

        if (newState == bytes32(0)) {
            revert InvalidEntityState();
        }

        Entity storage entity =
            entities[tenantId][entityId];

        if (entity.currentState == newState) {
            revert EntityStateUnchanged(
                tenantId,
                entityId,
                newState
            );
        }

        entity.currentState = newState;
        entity.updatedAt = uint64(block.timestamp);

        _emitTrace(
            tenantId,
            entityId,
            roleId,
            eventType,
            evidenceHash
        );
    }

    function updateEntityMetadata(
        bytes32 tenantId,
        bytes32 roleId,
        bytes32 entityId,
        bytes32 eventType,
        bytes32 newMetadataHash,
        bytes32 evidenceHash
    ) external {
        _requireCapability(
            tenantId,
            roleId,
            Capability.METADATA_UPDATE
        );

        _requireEntityExists(
            tenantId,
            entityId
        );

        _validateTraceEvidence(
            eventType,
            evidenceHash
        );

        if (newMetadataHash == bytes32(0)) {
            revert InvalidMetadataHash();
        }

        Entity storage entity =
            entities[tenantId][entityId];

        if (entity.metadataHash == newMetadataHash) {
            revert EntityMetadataUnchanged(
                tenantId,
                entityId,
                newMetadataHash
            );
        }

        entity.metadataHash = newMetadataHash;
        entity.updatedAt = uint64(block.timestamp);

        _emitTrace(
            tenantId,
            entityId,
            roleId,
            eventType,
            evidenceHash
        );
    }



    // ------------------------------------------------------------
    // Custody transfer
    // ------------------------------------------------------------

    function proposeCustodyTransfer(
        bytes32 tenantId,
        bytes32 roleId,
        bytes32 entityId,
        bytes32 toOrganizationId,
        bytes32 eventType,
        bytes32 evidenceHash
    ) external {
        _requireCapability(
            tenantId,
            roleId,
            Capability.CUSTODY_TRANSFER
        );

        _requireEntityExists(
            tenantId,
            entityId
        );

        _validateTraceEvidence(
            eventType,
            evidenceHash
        );

        _requireOrganizationActive(
            toOrganizationId
        );

        _requireActiveTenantMembership(
            tenantId,
            toOrganizationId
        );

        Entity storage entity =
            entities[tenantId][entityId];

        bytes32 callerOrganizationId =
            walletBindings[msg.sender]
                .organizationId;

        if (
            entity.currentCustodian !=
            callerOrganizationId
        ) {
            revert NotCurrentCustodian(
                tenantId,
                entityId,
                entity.currentCustodian,
                callerOrganizationId
            );
        }

        if (
            toOrganizationId ==
            callerOrganizationId
        ) {
            revert InvalidCustodyRecipient();
        }

        if (
            pendingCustodyTransfers[
                tenantId
            ][
                entityId
            ].exists
        ) {
            revert CustodyTransferAlreadyPending(
                tenantId,
                entityId
            );
        }

        uint64 proposedAt =
            uint64(block.timestamp);

        pendingCustodyTransfers[
            tenantId
        ][
            entityId
        ] = CustodyTransfer({
            fromOrganizationId:
                callerOrganizationId,
            toOrganizationId:
                toOrganizationId,
            proposedBy:
                msg.sender,
            proposedAt:
                proposedAt,
            exists:
                true
        });

        emit CustodyTransferProposed(
            tenantId,
            entityId,
            callerOrganizationId,
            toOrganizationId,
            roleId,
            msg.sender,
            eventType,
            evidenceHash,
            proposedAt
        );

        _emitTrace(
            tenantId,
            entityId,
            roleId,
            eventType,
            evidenceHash
        );
    }

    function acceptCustodyTransfer(
        bytes32 tenantId,
        bytes32 roleId,
        bytes32 entityId,
        bytes32 eventType,
        bytes32 evidenceHash
    ) external {
        _requireCapability(
            tenantId,
            roleId,
            Capability.CUSTODY_TRANSFER
        );

        _requireEntityExists(
            tenantId,
            entityId
        );

        _validateTraceEvidence(
            eventType,
            evidenceHash
        );

        CustodyTransfer memory transfer =
            pendingCustodyTransfers[
                tenantId
            ][
                entityId
            ];

        if (!transfer.exists) {
            revert CustodyTransferNotFound(
                tenantId,
                entityId
            );
        }

        bytes32 callerOrganizationId =
            walletBindings[msg.sender]
                .organizationId;

        if (
            callerOrganizationId !=
            transfer.toOrganizationId
        ) {
            revert NotCustodyRecipient(
                tenantId,
                entityId,
                transfer.toOrganizationId,
                callerOrganizationId
            );
        }

        Entity storage entity =
            entities[tenantId][entityId];

        if (
            entity.currentCustodian !=
            transfer.fromOrganizationId
        ) {
            revert CustodyChangedSinceProposal(
                tenantId,
                entityId
            );
        }

        bytes32 fromOrganizationId =
            transfer.fromOrganizationId;

        entity.currentCustodian =
            transfer.toOrganizationId;

        entity.updatedAt =
            uint64(block.timestamp);

        delete pendingCustodyTransfers[
            tenantId
        ][
            entityId
        ];

        emit CustodyTransferred(
            tenantId,
            entityId,
            fromOrganizationId,
            callerOrganizationId,
            roleId,
            msg.sender,
            eventType,
            evidenceHash,
            uint64(block.timestamp)
        );

        _emitTrace(
            tenantId,
            entityId,
            roleId,
            eventType,
            evidenceHash
        );
    }

    function cancelCustodyTransfer(
        bytes32 tenantId,
        bytes32 roleId,
        bytes32 entityId,
        bytes32 eventType,
        bytes32 evidenceHash
    ) external {
        _requireCapability(
            tenantId,
            roleId,
            Capability.CUSTODY_TRANSFER
        );

        _requireEntityExists(
            tenantId,
            entityId
        );

        _validateTraceEvidence(
            eventType,
            evidenceHash
        );

        CustodyTransfer memory transfer =
            pendingCustodyTransfers[
                tenantId
            ][
                entityId
            ];

        if (!transfer.exists) {
            revert CustodyTransferNotFound(
                tenantId,
                entityId
            );
        }

        bytes32 callerOrganizationId =
            walletBindings[msg.sender]
                .organizationId;

        if (
            callerOrganizationId !=
            transfer.fromOrganizationId
        ) {
            revert NotCurrentCustodian(
                tenantId,
                entityId,
                transfer.fromOrganizationId,
                callerOrganizationId
            );
        }

        delete pendingCustodyTransfers[
            tenantId
        ][
            entityId
        ];

        emit CustodyTransferCancelled(
            tenantId,
            entityId,
            transfer.fromOrganizationId,
            transfer.toOrganizationId,
            roleId,
            msg.sender,
            eventType,
            evidenceHash,
            uint64(block.timestamp)
        );

        _emitTrace(
            tenantId,
            entityId,
            roleId,
            eventType,
            evidenceHash
        );
    }



    function cancelCustodyTransferAsTenantAdmin(
        bytes32 tenantId,
        bytes32 entityId,
        bytes32 eventType,
        bytes32 evidenceHash
    ) external onlyTenantAdmin(tenantId) {
        _requireEntityExists(
            tenantId,
            entityId
        );

        _validateTraceEvidence(
            eventType,
            evidenceHash
        );

        CustodyTransfer memory transfer =
            pendingCustodyTransfers[
                tenantId
            ][
                entityId
            ];

        if (!transfer.exists) {
            revert CustodyTransferNotFound(
                tenantId,
                entityId
            );
        }

        delete pendingCustodyTransfers[
            tenantId
        ][
            entityId
        ];

        emit CustodyTransferCancelledByAdmin(
            tenantId,
            entityId,
            transfer.fromOrganizationId,
            transfer.toOrganizationId,
            msg.sender,
            eventType,
            evidenceHash,
            uint64(block.timestamp)
        );
    }



    // ------------------------------------------------------------
    // Entity relationships
    // ------------------------------------------------------------

    function createEntityLink(
        bytes32 tenantId,
        bytes32 roleId,
        bytes32 sourceEntityId,
        bytes32 targetEntityId,
        bytes32 linkType,
        bytes32 eventType,
        bytes32 evidenceHash
    ) external returns (bytes32 linkId) {
        _requireCapability(
            tenantId,
            roleId,
            Capability.ENTITY_LINK
        );

        _requireEntityExists(
            tenantId,
            sourceEntityId
        );

        _requireEntityExists(
            tenantId,
            targetEntityId
        );

        _validateTraceEvidence(
            eventType,
            evidenceHash
        );

        if (linkType == bytes32(0)) {
            revert InvalidLinkType();
        }

        if (sourceEntityId == targetEntityId) {
            revert SelfEntityLinkNotAllowed(
                sourceEntityId
            );
        }

        bytes32 organizationId =
            _requireCurrentEntityCustodian(
                tenantId,
                sourceEntityId
            );

        linkId = _entityLinkId(
            tenantId,
            sourceEntityId,
            targetEntityId,
            linkType
        );

        if (
            entityLinks[
                tenantId
            ][
                linkId
            ].exists
        ) {
            revert EntityLinkAlreadyExists(
                tenantId,
                linkId
            );
        }

        uint64 timestamp =
            uint64(block.timestamp);

        entityLinks[
            tenantId
        ][
            linkId
        ] = EntityLink({
            sourceEntityId:
                sourceEntityId,
            targetEntityId:
                targetEntityId,
            linkType:
                linkType,
            createdAt:
                timestamp,
            updatedAt:
                timestamp,
            exists:
                true,
            active:
                true
        });

        emit EntityLinkCreated(
            tenantId,
            linkId,
            sourceEntityId,
            targetEntityId,
            linkType,
            organizationId,
            roleId,
            msg.sender,
            eventType,
            evidenceHash,
            timestamp
        );
    }

    function setEntityLinkActive(
        bytes32 tenantId,
        bytes32 roleId,
        bytes32 sourceEntityId,
        bytes32 targetEntityId,
        bytes32 linkType,
        bool active,
        bytes32 eventType,
        bytes32 evidenceHash
    ) external {
        _requireCapability(
            tenantId,
            roleId,
            Capability.ENTITY_LINK
        );

        _requireEntityExists(
            tenantId,
            sourceEntityId
        );

        _requireEntityExists(
            tenantId,
            targetEntityId
        );

        _validateTraceEvidence(
            eventType,
            evidenceHash
        );

        bytes32 organizationId =
            _requireCurrentEntityCustodian(
                tenantId,
                sourceEntityId
            );

        bytes32 linkId =
            _entityLinkId(
                tenantId,
                sourceEntityId,
                targetEntityId,
                linkType
            );

        EntityLink storage entityLink =
            entityLinks[
                tenantId
            ][
                linkId
            ];

        if (!entityLink.exists) {
            revert EntityLinkNotFound(
                tenantId,
                linkId
            );
        }

        if (entityLink.active == active) {
            revert EntityLinkStatusUnchanged(
                tenantId,
                linkId,
                active
            );
        }

        entityLink.active = active;
        entityLink.updatedAt =
            uint64(block.timestamp);

        emit EntityLinkStatusChanged(
            tenantId,
            linkId,
            sourceEntityId,
            targetEntityId,
            linkType,
            active,
            organizationId,
            roleId,
            msg.sender,
            eventType,
            evidenceHash,
            entityLink.updatedAt
        );
    }


    // Read API
    // ------------------------------------------------------------

    function getTenant(
        bytes32 tenantId
    ) external view returns (Tenant memory) {
        _requireTenantExists(tenantId);

        return tenants[tenantId];
    }

    function getOrganization(
        bytes32 organizationId
    ) external view returns (Organization memory) {
        _requireOrganizationExists(
            organizationId
        );

        return organizations[organizationId];
    }

    function getWalletBinding(
        address wallet
    ) external view returns (WalletBinding memory) {
        WalletBinding memory binding =
            walletBindings[wallet];

        if (binding.organizationId == bytes32(0)) {
            revert WalletNotBound(wallet);
        }

        return binding;
    }

    function getTenantMembership(
        bytes32 tenantId,
        bytes32 organizationId
    ) external view returns (TenantMembership memory) {
        _requireTenantExists(tenantId);
        _requireOrganizationExists(
            organizationId
        );

        TenantMembership memory membership =
            tenantMemberships[tenantId][organizationId];

        if (!membership.exists) {
            revert TenantMembershipNotFound(
                tenantId,
                organizationId
            );
        }

        return membership;
    }

    function isTenantAdmin(
        bytes32 tenantId,
        address account
    ) external view returns (bool) {
        return tenantAdmins[tenantId][account];
    }

    function isActiveWalletForOrganization(
        address wallet,
        bytes32 organizationId
    ) external view returns (bool) {
        WalletBinding memory binding =
            walletBindings[wallet];

        return
            binding.organizationId == organizationId &&
            binding.active &&
            organizations[organizationId].active;
    }

    function isActiveTenantMember(
        bytes32 tenantId,
        bytes32 organizationId
    ) external view returns (bool) {
        TenantMembership memory membership =
            tenantMemberships[tenantId][organizationId];

        return
            tenants[tenantId].active &&
            organizations[organizationId].active &&
            membership.exists &&
            membership.active;
    }

    // ------------------------------------------------------------

    function getRole(
        bytes32 tenantId,
        bytes32 roleId
    ) external view returns (Role memory) {
        _requireRoleExists(
            tenantId,
            roleId
        );

        return roles[tenantId][roleId];
    }

    function getOrganizationRoleAssignment(
        bytes32 tenantId,
        bytes32 organizationId,
        bytes32 roleId
    ) external view returns (
        RoleAssignment memory
    ) {
        RoleAssignment memory assignment =
            organizationRoles[
                tenantId
            ][
                organizationId
            ][
                roleId
            ];

        if (!assignment.exists) {
            revert OrganizationRoleNotFound(
                tenantId,
                organizationId,
                roleId
            );
        }

        return assignment;
    }

    function roleHasCapability(
        bytes32 tenantId,
        bytes32 roleId,
        Capability capability
    ) external view returns (bool) {
        Role memory role =
            roles[tenantId][roleId];

        if (!role.exists || !role.active) {
            return false;
        }

        return
            (
                role.capabilityMask &
                _capabilityBit(capability)
            ) != 0;
    }

    function hasCapability(
        bytes32 tenantId,
        address wallet,
        bytes32 roleId,
        Capability capability
    ) public view returns (bool) {
        WalletBinding memory binding =
            walletBindings[wallet];

        if (
            binding.organizationId == bytes32(0) ||
            !binding.active
        ) {
            return false;
        }

        bytes32 organizationId =
            binding.organizationId;

        if (
            !tenants[tenantId].exists ||
            !tenants[tenantId].active
        ) {
            return false;
        }

        if (
            !organizations[organizationId].exists ||
            !organizations[organizationId].active
        ) {
            return false;
        }

        TenantMembership memory membership =
            tenantMemberships[
                tenantId
            ][
                organizationId
            ];

        if (
            !membership.exists ||
            !membership.active
        ) {
            return false;
        }

        Role memory role =
            roles[tenantId][roleId];

        if (!role.exists || !role.active) {
            return false;
        }

        RoleAssignment memory assignment =
            organizationRoles[
                tenantId
            ][
                organizationId
            ][
                roleId
            ];

        if (
            !assignment.exists ||
            !assignment.active
        ) {
            return false;
        }

        return
            (
                role.capabilityMask &
                _capabilityBit(capability)
            ) != 0;
    }



    function getEntity(
        bytes32 tenantId,
        bytes32 entityId
    ) external view returns (Entity memory) {
        Entity memory entity =
            entities[tenantId][entityId];

        if (!entity.exists) {
            revert EntityNotFound(
                tenantId,
                entityId
            );
        }

        return entity;
    }

    function entityExists(
        bytes32 tenantId,
        bytes32 entityId
    ) external view returns (bool) {
        return entities[tenantId][entityId].exists;
    }



    function getPendingCustodyTransfer(
        bytes32 tenantId,
        bytes32 entityId
    ) external view returns (
        CustodyTransfer memory
    ) {
        _requireEntityExists(
            tenantId,
            entityId
        );

        CustodyTransfer memory transfer =
            pendingCustodyTransfers[
                tenantId
            ][
                entityId
            ];

        if (!transfer.exists) {
            revert CustodyTransferNotFound(
                tenantId,
                entityId
            );
        }

        return transfer;
    }

    function hasPendingCustodyTransfer(
        bytes32 tenantId,
        bytes32 entityId
    ) external view returns (bool) {
        return pendingCustodyTransfers[
            tenantId
        ][
            entityId
        ].exists;
    }



    function computeEntityLinkId(
        bytes32 tenantId,
        bytes32 sourceEntityId,
        bytes32 targetEntityId,
        bytes32 linkType
    ) external pure returns (bytes32) {
        return _entityLinkId(
            tenantId,
            sourceEntityId,
            targetEntityId,
            linkType
        );
    }

    function getEntityLink(
        bytes32 tenantId,
        bytes32 sourceEntityId,
        bytes32 targetEntityId,
        bytes32 linkType
    ) external view returns (EntityLink memory) {
        bytes32 linkId =
            _entityLinkId(
                tenantId,
                sourceEntityId,
                targetEntityId,
                linkType
            );

        EntityLink memory entityLink =
            entityLinks[
                tenantId
            ][
                linkId
            ];

        if (!entityLink.exists) {
            revert EntityLinkNotFound(
                tenantId,
                linkId
            );
        }

        return entityLink;
    }

    function entityLinkExists(
        bytes32 tenantId,
        bytes32 sourceEntityId,
        bytes32 targetEntityId,
        bytes32 linkType
    ) external view returns (bool) {
        bytes32 linkId =
            _entityLinkId(
                tenantId,
                sourceEntityId,
                targetEntityId,
                linkType
            );

        return entityLinks[
            tenantId
        ][
            linkId
        ].exists;
    }


    // Internal validation
    // ------------------------------------------------------------




    function _entityLinkId(
        bytes32 tenantId,
        bytes32 sourceEntityId,
        bytes32 targetEntityId,
        bytes32 linkType
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                tenantId,
                sourceEntityId,
                targetEntityId,
                linkType
            )
        );
    }

    function _requireCurrentEntityCustodian(
        bytes32 tenantId,
        bytes32 entityId
    ) internal view returns (
        bytes32 organizationId
    ) {
        _requireEntityExists(
            tenantId,
            entityId
        );

        organizationId =
            walletBindings[msg.sender]
                .organizationId;

        bytes32 currentCustodian =
            entities[
                tenantId
            ][
                entityId
            ].currentCustodian;

        if (
            organizationId !=
            currentCustodian
        ) {
            revert NotCurrentCustodian(
                tenantId,
                entityId,
                currentCustodian,
                organizationId
            );
        }
    }


    function _requireEntityExists(
        bytes32 tenantId,
        bytes32 entityId
    ) internal view {
        if (!entities[tenantId][entityId].exists) {
            revert EntityNotFound(
                tenantId,
                entityId
            );
        }
    }

    function _validateTraceEvidence(
        bytes32 eventType,
        bytes32 evidenceHash
    ) internal pure {
        if (eventType == bytes32(0)) {
            revert InvalidEventType();
        }

        if (evidenceHash == bytes32(0)) {
            revert InvalidEvidenceHash();
        }
    }

    function _emitTrace(
        bytes32 tenantId,
        bytes32 entityId,
        bytes32 roleId,
        bytes32 eventType,
        bytes32 evidenceHash
    ) internal {
        Entity storage entity =
            entities[tenantId][entityId];

        bytes32 organizationId =
            walletBindings[msg.sender]
                .organizationId;

        emit TraceRecorded(
            tenantId,
            entityId,
            eventType,
            organizationId,
            roleId,
            msg.sender,
            evidenceHash,
            entity.currentState,
            entity.metadataHash,
            uint64(block.timestamp)
        );
    }


    function _requireActiveTenantMembership(
        bytes32 tenantId,
        bytes32 organizationId
    ) internal view {
        TenantMembership memory membership =
            tenantMemberships[
                tenantId
            ][
                organizationId
            ];

        if (!membership.exists) {
            revert TenantMembershipNotFound(
                tenantId,
                organizationId
            );
        }

        if (!membership.active) {
            revert TenantMembershipInactive(
                tenantId,
                organizationId
            );
        }
    }

    function _requireRoleExists(
        bytes32 tenantId,
        bytes32 roleId
    ) internal view {
        if (!roles[tenantId][roleId].exists) {
            revert RoleNotFound(
                tenantId,
                roleId
            );
        }
    }

    function _requireRoleActive(
        bytes32 tenantId,
        bytes32 roleId
    ) internal view {
        _requireRoleExists(
            tenantId,
            roleId
        );

        if (!roles[tenantId][roleId].active) {
            revert RoleInactive(
                tenantId,
                roleId
            );
        }
    }

    function _capabilityBit(
        Capability capability
    ) internal pure returns (uint256) {
        return uint256(1) << uint8(capability);
    }

    function _requireCapability(
        bytes32 tenantId,
        bytes32 roleId,
        Capability capability
    ) internal view {
        if (
            !hasCapability(
                tenantId,
                msg.sender,
                roleId,
                capability
            )
        ) {
            revert MissingCapability(
                tenantId,
                roleId,
                capability,
                msg.sender
            );
        }
    }


    function _requireTenantExists(
        bytes32 tenantId
    ) internal view {
        if (!tenants[tenantId].exists) {
            revert TenantNotFound(tenantId);
        }
    }

    function _requireTenantActive(
        bytes32 tenantId
    ) internal view {
        _requireTenantExists(tenantId);

        if (!tenants[tenantId].active) {
            revert TenantInactive(tenantId);
        }
    }

    function _requireOrganizationExists(
        bytes32 organizationId
    ) internal view {
        if (!organizations[organizationId].exists) {
            revert OrganizationNotFound(
                organizationId
            );
        }
    }

    function _requireOrganizationActive(
        bytes32 organizationId
    ) internal view {
        _requireOrganizationExists(
            organizationId
        );

        if (!organizations[organizationId].active) {
            revert OrganizationInactive(
                organizationId
            );
        }
    }
}
