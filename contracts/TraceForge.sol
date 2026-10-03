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

    mapping(bytes32 => Tenant) private tenants;

    mapping(bytes32 => Organization) private organizations;

    mapping(address => WalletBinding) private walletBindings;

    mapping(bytes32 => mapping(address => bool)) private tenantAdmins;

    mapping(bytes32 => mapping(bytes32 => TenantMembership))
        private tenantMemberships;

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
    // Internal validation
    // ------------------------------------------------------------

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
