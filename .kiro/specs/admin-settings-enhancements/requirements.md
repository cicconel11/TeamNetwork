# Requirements Document

## Introduction

This feature enhances the organization settings and admin capabilities in the TeamNetwork application. It includes allowing admins to rename their organization, propagating custom navigation labels throughout page content, enabling admins to delete mentorship pairs, and updating the contact email across the application.

## Glossary

- **Admin**: A user with the "admin" role in an organization who has elevated permissions
- **Organization**: A group entity in the system that contains members, alumni, and various features
- **Nav_Config**: A JSON configuration stored per organization that customizes navigation labels and visibility
- **Mentorship_Pair**: A relationship record linking a mentor (alumni) with a mentee (active member)
- **Settings_Page**: The organization settings page at `/{orgSlug}/settings`
- **Navigation_Settings_Page**: The page at `/{orgSlug}/settings/navigation` where admins configure nav labels

## Requirements

### Requirement 1: Organization Name Editing

**User Story:** As an admin, I want to change my organization's name from the settings page, so that I can update the display name when our organization rebrands or corrects a typo.

#### Acceptance Criteria

1. WHEN an admin visits the settings page, THE Settings_Page SHALL display an editable organization name field
2. WHEN a non-admin user visits the settings page, THE Settings_Page SHALL display the organization name as read-only
3. WHEN an admin submits a new organization name, THE System SHALL validate that the name is non-empty and under 100 characters
4. IF an admin submits an invalid organization name, THEN THE System SHALL display an appropriate error message and prevent the update
5. WHEN an admin successfully updates the organization name, THE System SHALL persist the change to the database and display a success message
6. WHEN the organization name is updated, THE System SHALL reflect the new name across the application without requiring a page refresh of the settings page

### Requirement 2: Dynamic Label Propagation in Page Content

**User Story:** As an organization admin, I want custom navigation labels to appear throughout the page content (like "Add Workout" becoming "Add Songs"), so that our customized terminology is consistent across the entire user experience.

#### Acceptance Criteria

1. WHEN an admin customizes a navigation label (e.g., "Workouts" to "Songs"), THE System SHALL store the custom label in the Nav_Config
2. WHEN a page renders action buttons or headers, THE System SHALL use the custom label from Nav_Config if one exists
3. WHEN no custom label exists, THE System SHALL fall back to the default label
4. THE System SHALL apply label substitution to:
   - Page headers/titles
   - "Add [Item]" buttons
   - Empty state messages
   - Breadcrumb text
5. WHEN the Nav_Config is updated, THE System SHALL reflect label changes on subsequent page loads

### Requirement 3: Admin Deletion of Mentorship Pairs

**User Story:** As an admin, I want to delete any mentorship pair, so that I can remove incorrect pairings or clean up when members leave the organization.

#### Acceptance Criteria

1. WHEN an admin views the mentorship page, THE System SHALL display a delete option for each mentorship pair
2. WHEN an admin clicks delete on a mentorship pair, THE System SHALL prompt for confirmation before deletion
3. WHEN an admin confirms deletion, THE System SHALL remove the mentorship pair and all associated logs from the database
4. IF deletion fails, THEN THE System SHALL display an error message and retain the pair
5. WHEN a mentorship pair is successfully deleted, THE System SHALL update the UI to remove the pair without requiring a full page refresh
6. THE System SHALL restrict mentorship pair deletion to admin users only

### Requirement 4: Contact Email Update

**User Story:** As a platform maintainer, I want the contact email updated to support@myteamnetwork.com, so that users reach the correct support channel.

#### Acceptance Criteria

1. THE System SHALL display "support@myteamnetwork.com" as the contact email on the terms page
2. THE System SHALL use "support@myteamnetwork.com" for the contact link in the landing page footer
3. THE System SHALL use "support@myteamnetwork.com" for the contact link in the terms page footer

### Requirement 5: UI Whitespace Optimization

**User Story:** As a user, I want reduced whitespace around buttons and sidebars, so that the interface feels more compact and efficient.

#### Acceptance Criteria

1. THE Settings_Page SHALL reduce excessive padding/margins around action buttons
2. THE Settings_Page SHALL optimize vertical spacing between card sections
3. WHEN viewing on desktop, THE System SHALL maintain appropriate visual hierarchy while reducing whitespace
4. WHEN viewing on mobile, THE System SHALL preserve touch-friendly spacing for interactive elements
