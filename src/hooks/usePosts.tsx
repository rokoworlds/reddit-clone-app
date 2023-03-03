import { authModalState } from '@/atoms/authModalAtom';
import { communityState } from '@/atoms/communitiesAtom';
import { Post, postState, PostVote } from '@/atoms/postsAtom';
import { auth, firestore, storage } from '@/firebase/clientApp';
import { doc, deleteDoc, writeBatch, collection, query, where, getDocs } from 'firebase/firestore';
import { deleteObject, ref } from 'firebase/storage';
import { useRouter } from 'next/router';
import React, { useEffect } from 'react';
import { useAuthState } from 'react-firebase-hooks/auth';
import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil';



const usePosts = () => {
    const [user] = useAuthState(auth)
    const router = useRouter()
    const [postStateValue, setPostStateValue] = useRecoilState(postState)
    const currentCommunity = useRecoilValue(communityState).currentCommunity
    const setAuthModalState = useSetRecoilState(authModalState)

    const onVote = async (event: React.MouseEvent<SVGElement, MouseEvent>, post: Post, vote: number, communityId: string) => {
        event.stopPropagation()
        // check for the user => if not, open auth modal

        if (!user?.uid) {
            setAuthModalState( { open: true, view: 'login'})
            return
        }



        const { voteStatus } = post
        const existingVote = postStateValue.postVotes.find(
            (vote) => vote.postId === post.id
            )

        try {

            const batch = writeBatch(firestore)
            const updatedPost = {...post}
            const updatedPosts = [...postStateValue.posts]
            let updatedPostVotes = [...postStateValue.postVotes]
            let voteChange = vote

            // new vote
            if (!existingVote) {
                // create a new postVote document
                const postVoteRef = doc(
                    collection(firestore, 'users', `${user?.uid}/postVotes`)
                )
                const newVote: PostVote = {
                    id: postVoteRef.id,
                    postId: post.id!,
                    communityId,
                    voteValue: vote, // 1 or -1
                }
                
                batch.set(postVoteRef, newVote)

                // add/substract 1 to/from post.voteStatus
                updatedPost.voteStatus = voteStatus + vote
                updatedPostVotes = [...updatedPostVotes, newVote]
            }
    
            // Existing vote - they have voted on the post before
            else {
                const postVoteRef = doc(
                    firestore,
                    'users',
                    `${user?.uid}/postVotes/${existingVote.id}`
                )
                // removing their vote (up => neutral OR down => neutral)
                if (existingVote.voteValue === vote) {
                    voteChange *= -1
                    // add/substract 1 to/from post.voteStatus
                    updatedPost.voteStatus = voteStatus - vote
                    updatedPostVotes = updatedPostVotes.filter(
                        (vote) => vote.id !== existingVote.id
                    )
                    // delete the postVote document
                    batch.delete(postVoteRef)

                    
                }

                // flipping their vote (up => down OR down => up)
                else {
                    // add/substract 2 to/from post.voteStatus
                    voteChange = 2 * vote;
                    updatedPost.voteStatus = voteStatus + 2 * vote

                    const voteIdx = postStateValue.postVotes.findIndex(
                        (vote) => vote.id === existingVote.id
                    )

                    if (voteIdx !== -1) {
                        updatedPostVotes[voteIdx] = {
                          ...existingVote,
                          voteValue: vote,
                        };
                      }

                    // updating the existing postVote document
                    batch.update(postVoteRef, {
                        voteValue: vote,
                      });
                }
            }
            let updatedState = { ...postStateValue, postVotes: updatedPostVotes };
            
            // update state with updated values
            const postIdx = postStateValue.posts.findIndex(
                (item) => item.id === post.id
                )
                setPostStateValue((prev) =>({
                    ...prev,
                    posts: updatedPosts,
                    postVotes: updatedPostVotes
                }))


                if (postStateValue.selectedPost) {
                    setPostStateValue((prev) => ({
                        ...prev,
                        selectedPost: updatedPost
                    }))
                }
                
                const postRef = doc(firestore, 'posts', post.id!)
                batch.update(postRef, { voteStatus: voteStatus + voteChange})
        
                await batch.commit()
        } catch (error) {
            console.log('onVote error', error)
        }


    }

    const onSelectPost = (post: Post) => {
        setPostStateValue((prev) => ({
            ...prev,
            selectedPost:post,
        }))
        router.push(`/r/${post.communityId}/comments/${post.id}`)
    }

    const onDeletePost = async (post: Post): Promise<boolean> => {
        try {
            // check if image, delete if exists
            if (post.imageURL) {
                const imageRef = ref(storage, `posts/@${post.id}/image`)
                await deleteObject(imageRef)
            }

            // delete post document from firestore
            const postDocRef = doc(firestore, 'posts', post.id!)
            await deleteDoc(postDocRef)

            // update recoil state
            setPostStateValue((prev) => ({
                ...prev,
                posts: prev.posts.filter((item) => item.id !== post.id)
            }))

            return true
        } catch (error) {
            return false
        }
    }

    const getCommunityPostVotes = async (communityId: string) => {
        const postVotesQuery = query(
            collection(firestore, 'users', `${user?.uid}/postVotes`),
            where('communityId', '==', communityId)
        )

        const postVoteDocs = await getDocs(postVotesQuery)
        const postVotes = postVoteDocs.docs.map((doc) => ({
            id: doc.id,
            ...doc.data()
        }))

        setPostStateValue((prev) => ({
            ...prev,
            postVotes: postVotes as PostVote[],
        }))


    }

    
    useEffect(() => {
        if (!user || !currentCommunity?.id) return
        getCommunityPostVotes(currentCommunity?.id)
    }, [user, currentCommunity])


    //  clear user postVotes
    useEffect(() => {
        if (!user) {
            setPostStateValue((prev) => ({
                ...prev,
                postVotes: [],
            }))
            return
        }
    }, [user])
    
    return {
        postStateValue,
        setPostStateValue,
        onVote,
        onSelectPost,
        onDeletePost,
    }
}
export default usePosts;