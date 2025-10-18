<?php
/**
 * Plugin Name: WPGraphQL Featured Image Extension
 * Plugin URI: https://github.com/your-org/revolution
 * Description: Adds featuredImageId field support to WPGraphQL CreatePostInput and UpdatePostInput mutations
 * Version: 1.0.0
 * Author: Revolution Team
 * Author URI: https://github.com/your-org
 * License: MIT
 * Text Domain: wpgraphql-featured-image-extension
 */

// Exit if accessed directly
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Check if WPGraphQL is active
 */
function wpgraphql_featured_image_check_dependencies() {
	if ( ! class_exists( 'WPGraphQL' ) ) {
		add_action( 'admin_notices', 'wpgraphql_featured_image_admin_notice' );
		return false;
	}
	return true;
}

/**
 * Admin notice if WPGraphQL is not active
 */
function wpgraphql_featured_image_admin_notice() {
	?>
	<div class="notice notice-error">
		<p><?php esc_html_e( 'WPGraphQL Featured Image Extension requires WPGraphQL to be installed and activated.', 'wpgraphql-featured-image-extension' ); ?></p>
	</div>
	<?php
}

/**
 * Initialize the plugin
 */
function wpgraphql_featured_image_init() {
	// Check dependencies
	if ( ! wpgraphql_featured_image_check_dependencies() ) {
		return;
	}

	// Register featuredImageId field to CreatePostInput
	add_action( 'graphql_register_types', 'wpgraphql_featured_image_register_input_fields' );

	// Process featuredImageId on post mutation
	add_action( 'graphql_post_object_mutation_update_additional_data', 'wpgraphql_featured_image_process_mutation', 10, 8 );
}
add_action( 'plugins_loaded', 'wpgraphql_featured_image_init' );

/**
 * Register featuredImageId field to CreatePostInput and UpdatePostInput
 *
 * This adds the featuredImageId field to all post type mutations (createPost, updatePost, etc.)
 * allowing clients to set the featured image via GraphQL mutation.
 */
function wpgraphql_featured_image_register_input_fields() {
	// Get all allowed post types
	$allowed_post_types = \WPGraphQL::get_allowed_post_types( 'objects' );

	foreach ( $allowed_post_types as $post_type_object ) {
		// Only add for post types that support thumbnail
		if ( ! post_type_supports( $post_type_object->name, 'thumbnail' ) ) {
			continue;
		}

		// Register field for CreatePostInput (e.g., CreatePostInput, CreatePageInput)
		$create_input_name = 'Create' . ucfirst( $post_type_object->graphql_single_name ) . 'Input';
		register_graphql_field( $create_input_name, 'featuredImageId', [
			'type'        => 'ID',
			'description' => __( 'The globally unique ID of the featured image to assign to the node. This should be the Global ID (base64 encoded) returned by WPGraphQL, not a database ID.', 'wpgraphql-featured-image-extension' ),
		] );

		// Register field for UpdatePostInput (e.g., UpdatePostInput, UpdatePageInput)
		$update_input_name = 'Update' . ucfirst( $post_type_object->graphql_single_name ) . 'Input';
		register_graphql_field( $update_input_name, 'featuredImageId', [
			'type'        => 'ID',
			'description' => __( 'The globally unique ID of the featured image to assign to the node. This should be the Global ID (base64 encoded) returned by WPGraphQL, not a database ID.', 'wpgraphql-featured-image-extension' ),
		] );
	}
}

/**
 * Process featuredImageId input on post object mutations
 *
 * This hook is called after a post is created or updated via GraphQL mutation.
 * It extracts the featuredImageId from the input, converts it to a database ID,
 * and sets it as the post's featured image using WordPress's _thumbnail_id meta.
 *
 * @param int                                  $post_id              The ID of the post being mutated
 * @param array<string,mixed>                  $input                The input for the mutation
 * @param \WP_Post_Type                        $post_type_object     The Post Type Object
 * @param string                               $mutation_name        The name of the mutation (createPost, updatePost, etc.)
 * @param \WPGraphQL\AppContext                $context              The AppContext
 * @param \GraphQL\Type\Definition\ResolveInfo $info                 The ResolveInfo
 * @param string                               $default_post_status  The default post status
 * @param string                               $intended_post_status The intended post status
 */
function wpgraphql_featured_image_process_mutation( $post_id, $input, $post_type_object, $mutation_name, $context, $info, $default_post_status, $intended_post_status ) {
	// Only process if featuredImageId is provided in the input
	if ( ! isset( $input['featuredImageId'] ) || empty( $input['featuredImageId'] ) ) {
		return;
	}

	// Check if the post type supports thumbnails
	if ( ! post_type_supports( $post_type_object->name, 'thumbnail' ) ) {
		return;
	}

	try {
		// Convert Global ID to database ID
		// WPGraphQL Global IDs are in format: base64('post:123') or base64('attachment:456')
		$media_db_id = \WPGraphQL\Utils\Utils::get_database_id_from_id( $input['featuredImageId'] );

		// Validate that we got a valid database ID
		if ( ! $media_db_id || ! is_numeric( $media_db_id ) ) {
			error_log( sprintf(
				'[WPGraphQL Featured Image Extension] Invalid featuredImageId provided: %s',
				$input['featuredImageId']
			) );
			return;
		}

		// Verify the media item exists and is an attachment
		$attachment = get_post( $media_db_id );
		if ( ! $attachment || 'attachment' !== $attachment->post_type ) {
			error_log( sprintf(
				'[WPGraphQL Featured Image Extension] Media item not found or not an attachment: ID %d',
				$media_db_id
			) );
			return;
		}

		// Set the featured image using WordPress standard meta
		// This is equivalent to set_post_thumbnail($post_id, $media_db_id)
		$result = update_post_meta( $post_id, '_thumbnail_id', $media_db_id );

		// Log success
		if ( $result ) {
			error_log( sprintf(
				'[WPGraphQL Featured Image Extension] Successfully set featured image %d for post %d',
				$media_db_id,
				$post_id
			) );
		}
	} catch ( Exception $e ) {
		// Log any errors but don't fail the mutation
		error_log( sprintf(
			'[WPGraphQL Featured Image Extension] Error setting featured image: %s',
			$e->getMessage()
		) );
	}
}
