<?php // Done is better than perfect

// サムネイルの有効化
add_theme_support('post-thumbnails');

// 抜粋の文字数変更
function change_excerpt_length($length)
{
	return 30;
}
add_filter('excerpt_length', 'change_excerpt_length');

// 抜粋の省略部分を表記変更
function change_excerpt_more($more)
{
	return '...';
}
add_filter('excerpt_more', 'change_excerpt_more');

// 日本語slug禁止
function auto_post_slug($slug, $post_ID, $post_status, $post_type)
{
	if (preg_match('/(%[0-9a-f]{2})+/', $slug)) {
		$slug = utf8_uri_encode($post_type) . '-' . $post_ID;
	}
	return $slug;
}
add_filter('wp_unique_post_slug', 'auto_post_slug', 10, 4);

// GraphQLのカスタムフィールドを追加
add_action('graphql_register_types', function () {

	$customposttype_graphql_single_name = "Post";

	register_graphql_field('RootQueryTo' . $customposttype_graphql_single_name . 'ConnectionWhereArgs', 'recommend', [
		'type' => 'Boolean',
		'description' => __('The ID of the post object to filter by', 'your-textdomain'),
	]);
});

// GraphQLのクエリ引数をカスタマイズ
add_filter('graphql_post_object_connection_query_args', function ($query_args, $source, $args, $context, $info) {

	$post_object_id = $args['where']['recommend'];

	if (isset($post_object_id)) {
		$query_args['meta_query'] = [
			[
				'key' => 'recommend',
				'value' => $post_object_id,
				'compare' => '='
			]
		];
	}

	return $query_args;
}, 10, 5);
