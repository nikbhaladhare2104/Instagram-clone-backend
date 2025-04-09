const Post = require('../models/postModel');
const Comment = require('../models/commentModel');


const axios = require('axios');


// const addComment = async(req,res)=>{
//     // #swagger.tags = ['Comment']

//     try{
//         const userId = req.user.userId;
//         const { postId }= req.params;
//         const {text} = req.body;

//         console.log("Authenticated user ID:",userId);

//         const post = await Post.findById(postId);
//         if(!post){
//             return res.status(404).json({message:"Post not found"});
//         }

//         if(!text){
//             return res.status(404).json({message:"text is required"});
//         }

//         const newComment = await Comment.create({user:userId, post:postId, text});

//         const commentCount = await Comment.countDocuments({ post: postId });
//         return res.status(201).json({message:"Comment added successfully",
//             comment:{
//                 commentCount,
//                 _id:newComment._id,
//                 text:newComment.text,
//                 user:userId,
//                 post:postId,
//                 createdAt:newComment.createdAt
//             }
//         });

//     }catch(error){
//         res.status(500).json({message:"Internal server error",error:error.message})
//     }

// }




const addComment = async (req, res) => {
  // #swagger.tags = ['Comment']
  try {
    const userId = req.user.userId;
    const { postId } = req.params;
    const { text } = req.body;

    console.log("Authenticated user ID:", userId);

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    if (!text) {
      return res.status(400).json({ message: "Text is required" });
    }

    //  Text Moderation using Sightengine
    const apiUser = '516692053';
    const apiSecret = '9yvVK3JG5bAmvf87M9JaWjweU5fAwk3p';

    const moderationResponse = await axios.get('https://api.sightengine.com/1.0/text/check.json', {
      params: {
        text: text,
        mode:'standard',
        lang:'en',
        api_user: apiUser,
        api_secret: apiSecret
      }
    });

    const moderationData = moderationResponse.data;
//  If profanity or inappropriate content is found
    if (moderationData.profanity && moderationData.profanity.matches.length > 0) {
     return res.status(403).json({
       message: "Inappropriate language detected in comment",
       status: "rejected",
       issues: moderationData.profanity.matches,
    });
  }

    //  Save comment if clean
    const newComment = await Comment.create({ user: userId, post: postId, text });

    const commentCount = await Comment.countDocuments({ post: postId });

    return res.status(201).json({
      message: 'Comment added successfully',
      status: 'approved',
      comment: {
        commentCount,
        _id: newComment._id,
        text: newComment.text,
        user: userId,
        post: postId,
        createdAt: newComment.createdAt
      }
    });

  } catch (error) {
    console.error('Text Moderation Error:', error?.response?.data || error.message);
    return res.status(500).json({
      message: 'Internal server error',
      error: error.message
    });
  }
};



const addReplyToComment = async (req, res) => {
    // #swagger.tags = ['Comment']

    try {
        const userId = req.user.userId;
        const { commentId } = req.params;
        const { text } = req.body;

        if (!text) {
            return res.status(400).json({ message: "Text is required" });
        }

        // Check if the parent comment exists
        const parentComment = await Comment.findById(commentId);
        if (!parentComment) {
            return res.status(404).json({ message: "Parent comment not found" });
        }

        // Create the reply (just linking it to parentComment)
        const newReply = await Comment.create({
            user: userId,
            text,
            parentComment: commentId
        });

        return res.status(201).json({
            message: "Reply added successfully",
            reply: {
                _id: newReply._id,
                text: newReply.text,
                user: userId,
                parent: commentId,
                createdAt: newReply.createdAt
            }
        });

    } catch (error) {
        return res.status(500).json({ message: "Internal server error", error: error.message });
    }
};


const deleteComment = async (req, res) => {
    // #swagger.tags = ['Comment']
    try {
        const userId = req.user.userId;
        const { commentId } = req.params;

        // Find the comment or reply (both are stored in Comment model)
        const comment = await Comment.findById(commentId);
        if (!comment) {
            return res.status(404).json({ message: "Comment/Reply not found" });
        }

        // Check if the authenticated user is the owner
        if (comment.user.toString() !== userId) {
            return res.status(403).json({ message: "Unauthorized! You can only delete your own comment/reply." });
        }

        // Recursively delete all nested replies
        const deleteNestedReplies = async (parentId) => {
            const replies = await Comment.find({ parentComment: parentId }); // Find replies linked to this comment

            for (const reply of replies) {
                await deleteNestedReplies(reply._id); // Recursively delete replies
                await Comment.findByIdAndDelete(reply._id); // Delete reply from DB
            }
        };

        await deleteNestedReplies(commentId); // Delete all nested replies
        await Comment.findByIdAndDelete(commentId); // Delete the original comment/reply

        return res.status(200).json({ message: "Comment/Reply and all its nested replies deleted successfully" });

    } catch (error) {
        return res.status(500).json({ message: "Internal server error", error: error.message });
    }
};


const getComments = async (req, res) => {
    // #swagger.tags = ['Comment']
    try {
        const userId = req.user.userId;
        const { postId } = req.params;

        console.log("Authenticated user ID:", userId);

        const post = await Post.findById(postId);
        if (!post) {
            return res.status(404).json({ message: "Post not found" });
        }

        // Fetch top-level comments (comments that are not replies)
        const comments = await Comment.find({ post: postId, parentComment: null })
            .populate("user", "username -isOtpVerified")
            .sort({ createdAt: -1 });

        // Recursive function to get replies for each comment
        const getReplies = async (parentId) => {
            const replies = await Comment.find({ parentComment: parentId })
                .populate("user", "username -isOtpVerified")
                .sort({ createdAt: 1 });

            return Promise.all(replies.map(async (reply) => ({
                _id: reply._id,
                text: reply.text,
                user: reply.user,
                createdAt: reply.createdAt,
                replies: await getReplies(reply._id) // Fetch nested replies
            })));
        };

        // Attach replies to each comment
        const structuredComments = await Promise.all(comments.map(async (comment) => ({
            _id: comment._id,
            text: comment.text,
            user: comment.user,
            createdAt: comment.createdAt,
            replies: await getReplies(comment._id) // Fetch all replies for this comment
        })));

        return res.status(200).json({
            message: "Comments and replies fetched successfully",
            totalComments: structuredComments.length,
            comments: structuredComments
        });

    } catch (error) {
        return res.status(500).json({ message: "Internal server error", error: error.message });
    }
};

module.exports= {addComment , deleteComment, addReplyToComment, getComments }