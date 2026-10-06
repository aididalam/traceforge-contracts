// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

contract TraceForge is Ownable2Step {
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
        RESERVED_4, // Preserve generic capability indices. Receive requires no role.
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

    // Registration identity is independent of later metadata edits and balances.
    struct Product {
        bytes32 registrationMetadataHash;
        bytes32 originOrganizationId;
        bytes32 rootRouteId;
        uint64 initialQuantity;
        uint64 availableQuantity;
        uint64 removedQuantity;
        bool exists;
    }

    struct BatchRoute {
        bytes32 organizationId;
        bytes32 parentRouteId;
        uint64 receivedQuantity;
        uint64 availableQuantity;
        uint64 forwardedQuantity;
        uint64 removedQuantity;
        uint64 version;
        uint64 createdAt;
        bool exists;
    }

    enum RemovalReason { Sold, Lost, Damaged, Spoiled, Disposed, Other }

    uint64 public constant MAX_PRODUCT_QUANTITY = 9_007_199_254_740_991;


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


    mapping(bytes32 => mapping(bytes32 => uint64)) private custodyVersions;

    mapping(bytes32 => mapping(bytes32 => Product)) private products;
    mapping(bytes32 => mapping(bytes32 => mapping(bytes32 => BatchRoute))) private batchRoutes;
    mapping(bytes32 => mapping(bytes32 => mapping(RemovalReason => uint64))) private removalTotals;

    mapping(bytes32 => mapping(bytes32 => EntityLink))
        private entityLinks;

    error OwnershipRenounceDisabled();

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

    error StaleCustody(bytes32 tenantId, bytes32 entityId, uint64 expectedVersion, uint64 actualVersion);

    error InvalidQuantity();
    error ProductNotFound(bytes32 tenantId, bytes32 entityId);
    error BatchOperationRequired();
    error ProductRemovalRequired();
    error NotBatchProduct();
    error InvalidRouteId();
    error RouteAlreadyExists(bytes32 routeId);
    error RouteNotFound(bytes32 routeId);
    error NotRouteOwner(bytes32 routeId, bytes32 organizationId);
    error InsufficientQuantity(uint64 requested, uint64 available);
    error StaleRoute(bytes32 routeId, uint64 expectedVersion, uint64 actualVersion);
    error InvalidRemovalReasonText();

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


    error EntityIsClosed(
        bytes32 tenantId,
        bytes32 entityId
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


    event CustodyClaimed(
        bytes32 indexed tenantId,
        bytes32 indexed entityId,
        bytes32 indexed fromOrganizationId,
        bytes32 toOrganizationId,
        address actor,
        bytes32 eventType,
        bytes32 evidenceHash,
        uint64 custodyVersion,
        uint64 timestamp
    );

    event ProductRegistered(
        bytes32 indexed tenantId,
        bytes32 indexed entityId,
        bytes32 indexed rootRouteId,
        bytes32 organizationId,
        address actor,
        bytes32 registrationMetadataHash,
        uint64 initialQuantity,
        uint64 timestamp
    );

    event BatchReceived(
        bytes32 indexed tenantId,
        bytes32 indexed entityId,
        bytes32 indexed sourceRouteId,
        bytes32 receivedRouteId,
        bytes32 fromOrganizationId,
        bytes32 toOrganizationId,
        address actor,
        uint64 quantity,
        uint64 sourceAvailableQuantity,
        uint64 sourceForwardedQuantity,
        uint64 sourceVersion,
        bytes32 evidenceHash,
        uint64 timestamp
    );

    event QuantityRemoved(
        bytes32 indexed tenantId,
        bytes32 indexed entityId,
        bytes32 indexed routeId,
        bytes32 organizationId,
        address actor,
        uint64 quantity,
        RemovalReason reason,
        string reasonText,
        uint64 routeAvailableQuantity,
        uint64 routeRemovedQuantity,
        uint64 version,
        uint64 availableQuantity,
        uint64 removedQuantity,
        bytes32 evidenceHash,
        uint64 timestamp
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


    event EntityClosed(
        bytes32 indexed tenantId,
        bytes32 indexed entityId,
        bytes32 indexed organizationId,
        bytes32 roleId,
        address actor,
        bytes32 eventType,
        bytes32 evidenceHash,
        uint64 closedAt
    );

    constructor() Ownable(msg.sender) {}

    // ------------------------------------------------------------
    // Platform ownership
    // ------------------------------------------------------------

    function renounceOwnership()
        public
        override
        onlyOwner
    {
        revert OwnershipRenounceDisabled();
    }

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

    /// Independent businesses bind only their own wallet; existing identities cannot be replaced.
    function registerBusiness(bytes32 organizationId, bytes32 metadataHash) external {
        if (organizationId == bytes32(0)) revert InvalidOrganizationId();
        if (metadataHash == bytes32(0)) revert InvalidMetadataHash();
        if (organizations[organizationId].exists) revert OrganizationAlreadyExists(organizationId);
        bytes32 existing = walletBindings[msg.sender].organizationId;
        if (existing != bytes32(0)) revert WalletAlreadyBound(msg.sender, existing);
        uint64 timestamp = uint64(block.timestamp);
        organizations[organizationId] = Organization(true, true, metadataHash, timestamp);
        walletBindings[msg.sender] = WalletBinding(organizationId, true);
        emit OrganizationRegistered(organizationId, metadataHash, timestamp);
        emit WalletBound(msg.sender, organizationId);
    }

    /// A business can create its own production workspace without platform approval.
    function createBusinessWorkspace(bytes32 tenantId, bytes32 metadataHash, bytes32 roleId) external {
        bytes32 organizationId = _requireActiveBusinessWallet();
        if (tenantId == bytes32(0)) revert InvalidTenantId();
        if (tenants[tenantId].exists) revert TenantAlreadyExists(tenantId);
        if (metadataHash == bytes32(0)) revert InvalidMetadataHash();
        if (roleId == bytes32(0)) revert InvalidRoleId();
        uint64 timestamp = uint64(block.timestamp);
        tenants[tenantId] = Tenant(true, true, metadataHash, timestamp);
        tenantAdmins[tenantId][msg.sender] = true;
        tenantMemberships[tenantId][organizationId] = TenantMembership(true, true, timestamp);
        uint256 mask = 47; // Generic create, trace, state, metadata and link. No receiving role.
        roles[tenantId][roleId] = Role(true, true, metadataHash, mask, timestamp);
        organizationRoles[tenantId][organizationId][roleId] = RoleAssignment(true, true, timestamp);
        emit TenantCreated(tenantId, metadataHash, msg.sender, timestamp);
        emit TenantAdminChanged(tenantId, msg.sender, true);
        emit OrganizationAddedToTenant(tenantId, organizationId, timestamp);
        emit RoleCreated(tenantId, roleId, metadataHash, timestamp);
        for (uint8 i = 0; i < 6; i++) {
            if (i != 4) emit RoleCapabilityChanged(tenantId, roleId, Capability(i), true);
        }
        emit OrganizationRoleAssigned(tenantId, organizationId, roleId, timestamp);
    }

    function _requireActiveBusinessWallet() internal view returns (bytes32 organizationId) {
        WalletBinding memory binding = walletBindings[msg.sender];
        organizationId = binding.organizationId;
        if (organizationId == bytes32(0) || !binding.active) revert WalletNotBound(msg.sender);
        _requireOrganizationActive(organizationId);
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
        _createEntity(tenantId, roleId, entityId, entityType, metadataHash, initialState);
    }

    function _createEntity(
        bytes32 tenantId, bytes32 roleId, bytes32 entityId,
        bytes32 entityType, bytes32 metadataHash, bytes32 initialState
    ) internal {
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

    /// Business product registration; quantity is immutable and defaults in the API.
    function createProduct(
        bytes32 tenantId, bytes32 roleId, bytes32 entityId,
        bytes32 metadataHash, uint64 quantity
    ) external {
        if (quantity == 0 || quantity > MAX_PRODUCT_QUANTITY) revert InvalidQuantity();
        _createEntity(tenantId, roleId, entityId, keccak256("PRODUCT"), metadataHash, keccak256("PRODUCED"));
        Entity storage entity = entities[tenantId][entityId];
        bytes32 organizationId = entity.currentCustodian;
        bytes32 rootRouteId;
        if (quantity > 1) {
            rootRouteId = computeRootRouteId(tenantId, entityId);
            batchRoutes[tenantId][entityId][rootRouteId] = BatchRoute({
                organizationId: organizationId, parentRouteId: bytes32(0),
                receivedQuantity: quantity, availableQuantity: quantity,
                forwardedQuantity: 0, removedQuantity: 0, version: 0,
                createdAt: entity.createdAt, exists: true
            });
            // No single custodian represents all branches of a batch.
            entity.currentCustodian = bytes32(0);
        }
        products[tenantId][entityId] = Product({
            registrationMetadataHash: metadataHash, originOrganizationId: organizationId,
            rootRouteId: rootRouteId, initialQuantity: quantity,
            availableQuantity: quantity, removedQuantity: 0, exists: true
        });
        emit ProductRegistered(tenantId, entityId, rootRouteId, organizationId, msg.sender,
            metadataHash, quantity, entity.createdAt);
    }

    function computeRootRouteId(bytes32 tenantId, bytes32 entityId) public view returns (bytes32) {
        return keccak256(abi.encode(keccak256("TRACEFORGE_ROOT_ROUTE_V1"), block.chainid, address(this), tenantId, entityId));
    }

    function getProduct(bytes32 tenantId, bytes32 entityId) external view returns (Product memory) {
        _requireProduct(tenantId, entityId);
        return products[tenantId][entityId];
    }

    function getBatchRoute(bytes32 tenantId, bytes32 entityId, bytes32 routeId) external view returns (BatchRoute memory) {
        _requireProduct(tenantId, entityId);
        _requireRoute(tenantId, entityId, routeId);
        return batchRoutes[tenantId][entityId][routeId];
    }

    function getRemovalTotal(bytes32 tenantId, bytes32 entityId, RemovalReason reason) external view returns (uint64) {
        _requireProduct(tenantId, entityId);
        return removalTotals[tenantId][entityId][reason];
    }

    /// Physical receipt is declared by the receiver; source approval is not required.
    function claimBatch(
        bytes32 tenantId, bytes32 entityId, bytes32 sourceRouteId, bytes32 receivedRouteId,
        uint64 expectedVersion, uint64 quantity, bytes32 evidenceHash
    ) external {
        bytes32 receiver = _requireActiveBusinessWallet();
        _requireTenantActive(tenantId);
        _requireEntityOpen(tenantId, entityId);
        _requireProduct(tenantId, entityId);
        if (products[tenantId][entityId].initialQuantity == 1) revert NotBatchProduct();
        if (evidenceHash == bytes32(0)) revert InvalidEvidenceHash();
        _requireRoute(tenantId, entityId, sourceRouteId);
        BatchRoute storage source = batchRoutes[tenantId][entityId][sourceRouteId];
        if (receiver == source.organizationId) revert InvalidCustodyRecipient();
        _requireRouteVersion(sourceRouteId, source.version, expectedVersion);
        _requireQuantity(quantity, source.availableQuantity);
        if (receivedRouteId == bytes32(0)) revert InvalidRouteId();
        if (batchRoutes[tenantId][entityId][receivedRouteId].exists) revert RouteAlreadyExists(receivedRouteId);

        source.availableQuantity -= quantity;
        source.forwardedQuantity += quantity;
        source.version += 1;
        uint64 timestamp = uint64(block.timestamp);
        batchRoutes[tenantId][entityId][receivedRouteId] = BatchRoute({
            organizationId: receiver, parentRouteId: sourceRouteId,
            receivedQuantity: quantity, availableQuantity: quantity,
            forwardedQuantity: 0, removedQuantity: 0, version: 0,
            createdAt: timestamp, exists: true
        });
        entities[tenantId][entityId].updatedAt = timestamp;
        emit BatchReceived(tenantId, entityId, sourceRouteId, receivedRouteId,
            source.organizationId, receiver, msg.sender, quantity, source.availableQuantity,
            source.forwardedQuantity, source.version, evidenceHash, timestamp);
    }

    /// Only the holder may remove quantity. The full written reason is immutable in the log.
    function removeProduct(
        bytes32 tenantId, bytes32 entityId, bytes32 routeId, uint64 quantity,
        uint64 expectedVersion, RemovalReason reason, string calldata reasonText, bytes32 evidenceHash
    ) external {
        bytes32 organizationId = _requireActiveBusinessWallet();
        _requireTenantActive(tenantId);
        _requireEntityOpen(tenantId, entityId);
        _requireProduct(tenantId, entityId);
        if (evidenceHash == bytes32(0)) revert InvalidEvidenceHash();
        _validateRemovalReason(reason, reasonText);
        Product storage product = products[tenantId][entityId];
        uint64 version;
        uint64 routeAvailable;
        uint64 routeRemoved;
        if (product.initialQuantity > 1) {
            _requireRoute(tenantId, entityId, routeId);
            BatchRoute storage route = batchRoutes[tenantId][entityId][routeId];
            if (route.organizationId != organizationId) revert NotRouteOwner(routeId, organizationId);
            _requireRouteVersion(routeId, route.version, expectedVersion);
            _requireQuantity(quantity, route.availableQuantity);
            route.availableQuantity -= quantity;
            route.removedQuantity += quantity;
            route.version += 1;
            version = route.version;
            routeAvailable = route.availableQuantity;
            routeRemoved = route.removedQuantity;
        } else {
            if (routeId != bytes32(0)) revert InvalidRouteId();
            _requireCurrentEntityCustodian(tenantId, entityId);
            version = custodyVersions[tenantId][entityId];
            if (expectedVersion != version) revert StaleCustody(tenantId, entityId, expectedVersion, version);
            _requireQuantity(quantity, product.availableQuantity);
            custodyVersions[tenantId][entityId] = ++version;
            routeRemoved = quantity;
        }
        product.availableQuantity -= quantity;
        product.removedQuantity += quantity;
        removalTotals[tenantId][entityId][reason] += quantity;
        Entity storage entity = entities[tenantId][entityId];
        entity.updatedAt = uint64(block.timestamp);
        entity.closed = product.availableQuantity == 0;
        emit QuantityRemoved(tenantId, entityId, routeId, organizationId, msg.sender,
            quantity, reason, reasonText, routeAvailable, routeRemoved, version,
            product.availableQuantity, product.removedQuantity, evidenceHash, entity.updatedAt);
    }

    function _requireProduct(bytes32 tenantId, bytes32 entityId) internal view {
        if (!products[tenantId][entityId].exists) revert ProductNotFound(tenantId, entityId);
    }

    function _requireRoute(bytes32 tenantId, bytes32 entityId, bytes32 routeId) internal view {
        if (!batchRoutes[tenantId][entityId][routeId].exists) revert RouteNotFound(routeId);
    }

    function _requireRouteVersion(bytes32 routeId, uint64 actual, uint64 expected) internal pure {
        if (actual != expected) revert StaleRoute(routeId, expected, actual);
    }

    function _requireQuantity(uint64 quantity, uint64 available) internal pure {
        if (quantity == 0) revert InvalidQuantity();
        if (quantity > available) revert InsufficientQuantity(quantity, available);
    }

    function _requireSingleCustodian(bytes32 tenantId, bytes32 entityId) internal view {
        if (products[tenantId][entityId].initialQuantity > 1) revert BatchOperationRequired();
    }

    // Validate UTF-8 even for direct contract callers, and bound both bytes and characters.
    function _validateRemovalReason(RemovalReason reason, string calldata text) internal pure {
        bytes calldata raw = bytes(text);
        if (raw.length > 1024) revert InvalidRemovalReasonText();
        uint256 characters;
        bool hasText;
        for (uint256 i; i < raw.length;) {
            uint256 lead = uint8(raw[i]);
            uint256 size;
            uint256 codepoint;
            if (lead < 0x80) { size = 1; codepoint = lead; }
            else if (lead >= 0xc2 && lead <= 0xdf) { size = 2; codepoint = lead & 0x1f; }
            else if (lead >= 0xe0 && lead <= 0xef) { size = 3; codepoint = lead & 0x0f; }
            else if (lead >= 0xf0 && lead <= 0xf4) { size = 4; codepoint = lead & 0x07; }
            else revert InvalidRemovalReasonText();
            if (i + size > raw.length) revert InvalidRemovalReasonText();
            for (uint256 j = 1; j < size; ++j) {
                uint256 tail = uint8(raw[i + j]);
                if ((tail & 0xc0) != 0x80) revert InvalidRemovalReasonText();
                codepoint = (codepoint << 6) | (tail & 0x3f);
            }
            if ((size == 3 && (codepoint < 0x800 || (codepoint >= 0xd800 && codepoint <= 0xdfff))) ||
                (size == 4 && (codepoint < 0x10000 || codepoint > 0x10ffff))) revert InvalidRemovalReasonText();
            if ((codepoint < 0x20 && codepoint != 9 && codepoint != 10 && codepoint != 13) ||
                (codepoint >= 0x7f && codepoint <= 0x9f)) revert InvalidRemovalReasonText();
            bool whitespace = codepoint <= 0x20 || codepoint == 0xa0 || codepoint == 0x1680 ||
                (codepoint >= 0x2000 && codepoint <= 0x200a) || codepoint == 0x2028 || codepoint == 0x2029 ||
                codepoint == 0x202f || codepoint == 0x205f || codepoint == 0x3000 || codepoint == 0xfeff;
            if (!whitespace) hasText = true;
            if (++characters > 256) revert InvalidRemovalReasonText();
            i += size;
        }
        if (reason != RemovalReason.Sold && !hasText) revert InvalidRemovalReasonText();
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

        _requireEntityOpen(
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

        _requireEntityOpen(
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

        _requireEntityOpen(
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

    /// The receiver declares physical receipt without a sender proposal or workspace role.
    /// The version prevents replay of an old receipt after custody changes away and back.
    function claimCustody(
        bytes32 tenantId, bytes32 entityId, uint64 expectedVersion,
        bytes32 eventType, bytes32 evidenceHash
    ) external {
        bytes32 receiver = _requireActiveBusinessWallet();
        _requireTenantActive(tenantId);
        _requireEntityOpen(tenantId, entityId);
        _requireSingleCustodian(tenantId, entityId);
        _validateTraceEvidence(eventType, evidenceHash);
        uint64 version = custodyVersions[tenantId][entityId];
        if (expectedVersion != version) revert StaleCustody(tenantId, entityId, expectedVersion, version);
        Entity storage entity = entities[tenantId][entityId];
        bytes32 previous = entity.currentCustodian;
        if (previous == receiver) revert InvalidCustodyRecipient();
        entity.currentCustodian = receiver;
        entity.updatedAt = uint64(block.timestamp);
        custodyVersions[tenantId][entityId] = version + 1;
        emit CustodyClaimed(tenantId, entityId, previous, receiver, msg.sender,
            eventType, evidenceHash, version + 1, entity.updatedAt);
        _emitTrace(tenantId, entityId, bytes32(0), eventType, evidenceHash);
    }

    function getCustodyVersion(bytes32 tenantId, bytes32 entityId) external view returns (uint64) {
        _requireEntityExists(tenantId, entityId);
        _requireSingleCustodian(tenantId, entityId);
        return custodyVersions[tenantId][entityId];
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

        _requireEntityOpen(
            tenantId,
            sourceEntityId
        );

        _requireEntityOpen(
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

        _requireEntityOpen(
            tenantId,
            sourceEntityId
        );

        _requireEntityOpen(
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



    // ------------------------------------------------------------
    // Entity lifecycle
    // ------------------------------------------------------------

    function closeEntity(
        bytes32 tenantId,
        bytes32 roleId,
        bytes32 entityId,
        bytes32 eventType,
        bytes32 evidenceHash
    ) external {
        _requireActiveBusinessWallet();
        _requireTenantActive(tenantId);

        _requireEntityOpen(
            tenantId,
            entityId
        );

        _requireSingleCustodian(tenantId, entityId);
        // New singles use removeProduct too, retaining quantity/reason/version evidence.
        if (products[tenantId][entityId].exists) revert ProductRemovalRequired();

        _validateTraceEvidence(
            eventType,
            evidenceHash
        );

        bytes32 organizationId =
            _requireCurrentEntityCustodian(
                tenantId,
                entityId
            );

        Entity storage entity =
            entities[tenantId][entityId];

        uint64 timestamp =
            uint64(block.timestamp);

        entity.closed = true;
        custodyVersions[tenantId][entityId] += 1;
        entity.updatedAt = timestamp;

        emit EntityClosed(
            tenantId,
            entityId,
            organizationId,
            roleId,
            msg.sender,
            eventType,
            evidenceHash,
            timestamp
        );

        _emitTrace(
            tenantId,
            entityId,
            roleId,
            eventType,
            evidenceHash
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

        _requireSingleCustodian(tenantId, entityId);

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



    function _requireEntityOpen(
        bytes32 tenantId,
        bytes32 entityId
    ) internal view {
        _requireEntityExists(
            tenantId,
            entityId
        );

        if (
            entities[
                tenantId
            ][
                entityId
            ].closed
        ) {
            revert EntityIsClosed(
                tenantId,
                entityId
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
